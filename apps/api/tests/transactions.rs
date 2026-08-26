mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn creates_transactions_from_active_owned_wallet_and_matching_category(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "transaction-create@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = insert_wallet(&pool, user_id, "USD", false).await;
    let category = insert_category(&pool, user_id, "EXPENSE").await;

    let created = app
        .clone()
        .oneshot(post_transaction(
            &cookie,
            json!({
                "wallet_id": wallet,
                "category_id": category,
                "direction": "expense",
                "amount": "12.34",
                "note": "🪨".repeat(500),
            }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = response_json(created).await;
    assert_eq!(created["currency"], "USD");
    assert_eq!(created["amount"], "12.34");
    assert_eq!(created["direction"], "expense");
    assert_eq!(created["wallet_id"], wallet.to_string());
    assert_eq!(created["category_id"], category.to_string());
    assert!(created["occurred_at"].is_string());
    assert!(created["deleted_at"].is_null());
    assert!(created["purge_after"].is_null());

    for invalid in [
        json!({ "wallet_id": wallet, "category_id": category, "direction": "expense", "amount": "12.345" }),
        json!({ "wallet_id": wallet, "category_id": category, "direction": "expense", "amount": "0" }),
        json!({ "wallet_id": wallet, "category_id": category, "direction": "expense", "amount": "-1" }),
        json!({ "wallet_id": wallet, "category_id": category, "direction": "expense", "amount": "NaN" }),
        json!({ "wallet_id": wallet, "category_id": category, "direction": "income", "amount": "1.00" }),
        json!({ "wallet_id": wallet, "category_id": category, "direction": "expense", "amount": "1.00", "note": "🪨".repeat(501) }),
    ] {
        let response = app
            .clone()
            .oneshot(post_transaction(&cookie, invalid))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let transaction_count: i64 = sqlx::query_scalar("SELECT count(*) FROM transactions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        transaction_count, 1,
        "invalid amounts must fail before SQL writes"
    );

    let archived_wallet = insert_wallet(&pool, user_id, "USD", true).await;
    let response = app
        .oneshot(post_transaction(
            &cookie,
            json!({ "wallet_id": archived_wallet, "category_id": category, "direction": "expense", "amount": "1.00" }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[sqlx::test(migrations = false)]
async fn entry_defaults_select_only_most_recent_active_wallet_for_authenticated_user(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "transaction-defaults@example.test").await;
    let (_other_id, other_cookie) =
        authenticated_user(&pool, "transaction-defaults-other@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });

    let empty = app
        .clone()
        .oneshot(get_entry_defaults(&cookie))
        .await
        .unwrap();
    assert_eq!(empty.status(), StatusCode::OK);
    assert_eq!(
        response_json(empty).await,
        json!({ "last_used_wallet_id": null, "timezone": "Etc/UTC" })
    );

    let older = insert_wallet(&pool, user_id, "USD", false).await;
    let newer = insert_wallet(&pool, user_id, "USD", false).await;
    let category = insert_category(&pool, user_id, "EXPENSE").await;
    insert_transaction(
        &pool,
        user_id,
        older,
        category,
        Utc::now() - Duration::hours(2),
        false,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        newer,
        category,
        Utc::now() - Duration::hours(1),
        false,
    )
    .await;
    sqlx::query("UPDATE users SET timezone = 'Asia/Jakarta' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let active = app
        .clone()
        .oneshot(get_entry_defaults(&cookie))
        .await
        .unwrap();
    assert_eq!(active.status(), StatusCode::OK);
    assert_eq!(
        response_json(active).await,
        json!({ "last_used_wallet_id": newer.to_string(), "timezone": "Asia/Jakarta" })
    );

    sqlx::query("UPDATE wallets SET archived_at = now() WHERE id = $1")
        .bind(newer)
        .execute(&pool)
        .await
        .unwrap();
    let archived = app
        .clone()
        .oneshot(get_entry_defaults(&cookie))
        .await
        .unwrap();
    assert_eq!(
        response_json(archived).await,
        json!({ "last_used_wallet_id": older.to_string(), "timezone": "Asia/Jakarta" })
    );

    let isolated = app
        .oneshot(get_entry_defaults(&other_cookie))
        .await
        .unwrap();
    assert_eq!(isolated.status(), StatusCode::OK);
    assert_eq!(
        response_json(isolated).await,
        json!({ "last_used_wallet_id": null, "timezone": "Etc/UTC" })
    );
}

#[sqlx::test(migrations = false)]
async fn manual_local_times_use_stored_timezone_and_reject_invalid_inputs(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "transaction-time@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = insert_wallet(&pool, user_id, "USD", false).await;
    let category = insert_category(&pool, user_id, "EXPENSE").await;
    sqlx::query("UPDATE users SET timezone = 'Asia/Jakarta' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let before = Utc::now();
    let created = app
        .clone()
        .oneshot(post_transaction(
            &cookie,
            json!({
                "wallet_id": wallet,
                "category_id": category,
                "direction": "expense",
                "amount": "1.00",
                "occurred_local": "2026-08-31T23:30"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let created = response_json(created).await;
    let transaction_id = created["id"].as_str().unwrap();
    assert_eq!(created["occurred_at"], "2026-08-31T16:30:00+00:00");

    let defaulted = app
        .clone()
        .oneshot(post_transaction(
            &cookie,
            json!({ "wallet_id": wallet, "category_id": category, "direction": "expense", "amount": "1.00" }),
        ))
        .await
        .unwrap();
    assert_eq!(defaulted.status(), StatusCode::CREATED);
    let defaulted = response_json(defaulted).await;
    let defaulted_id = defaulted["id"].as_str().unwrap();
    let defaulted_instant = parse_instant(&defaulted["occurred_at"]);
    assert!(defaulted_instant >= before && defaulted_instant <= Utc::now() + Duration::seconds(1));
    assert_ne!(defaulted_instant.timestamp_subsec_nanos(), 0);
    let unchanged = app
        .clone()
        .oneshot(patch_transaction(
            &cookie,
            defaulted_id,
            json!({ "note": "edited" }),
        ))
        .await
        .unwrap();
    assert_eq!(unchanged.status(), StatusCode::OK);
    assert_eq!(
        response_json(unchanged).await["occurred_at"],
        defaulted["occurred_at"]
    );

    sqlx::query("UPDATE users SET timezone = 'America/New_York' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let updated = app
        .clone()
        .oneshot(patch_transaction(
            &cookie,
            transaction_id,
            json!({ "occurred_local": "2026-11-01T01:30" }),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(
        response_json(updated).await["occurred_at"],
        "2026-11-01T05:30:00+00:00"
    );

    for (case, occurred_local) in [
        ("nonexistent local time", "2026-03-08T02:30"),
        ("malformed separator", "2026/09/01T23:30"),
        ("malformed month width", "2026-9-01T23:30"),
        ("seconds", "2026-09-01T23:30:00"),
        ("offset", "2026-09-01T23:30+07:00"),
        ("UTC marker", "2026-09-01T23:30Z"),
        ("impossible date", "2026-02-30T23:30"),
    ] {
        let rejected = app
            .clone()
            .oneshot(post_transaction(
                &cookie,
                json!({
                    "wallet_id": wallet,
                    "category_id": category,
                    "direction": "expense",
                    "amount": "1.00",
                    "occurred_local": occurred_local,
                }),
            ))
            .await
            .unwrap();
        assert_eq!(
            rejected.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{case} must reject"
        );
        assert_eq!(
            response_json(rejected).await["error"]["fields"]["occurred_local"],
            json!(["invalid"]),
            "{case} must identify occurred_local"
        );
    }
}

#[sqlx::test(migrations = false)]
async fn trash_restore_and_permanent_purge_enforce_lifecycle_and_preserve_occurrence(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "transaction-lifecycle@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = insert_wallet(&pool, user_id, "USD", false).await;
    let category = insert_category(&pool, user_id, "EXPENSE").await;
    let transaction = create_transaction(&app, &cookie, wallet, category, "5.00").await;
    let transaction_id = transaction["id"].as_str().unwrap();

    let deleted = app
        .clone()
        .oneshot(delete_transaction(&cookie, transaction_id))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::OK);
    let deleted = response_json(deleted).await;
    let deleted_at = parse_instant(&deleted["deleted_at"]);
    assert_eq!(
        parse_instant(&deleted["purge_after"]),
        deleted_at + Duration::days(30)
    );
    let active_report_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM transactions WHERE user_id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        active_report_count, 0,
        "Trash rows must be excluded from budget/report inputs"
    );

    let restored = app
        .clone()
        .oneshot(post_restore(&cookie, transaction_id))
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
    let restored = response_json(restored).await;
    assert!(restored["deleted_at"].is_null() && restored["purge_after"].is_null());

    let active_purge = app
        .clone()
        .oneshot(delete_permanently(&cookie, transaction_id))
        .await
        .unwrap();
    assert_eq!(active_purge.status(), StatusCode::NOT_FOUND);

    let trashed_again = app
        .clone()
        .oneshot(delete_transaction(&cookie, transaction_id))
        .await
        .unwrap();
    assert_eq!(trashed_again.status(), StatusCode::OK);

    let occurrence_id: Uuid = sqlx::query_scalar(
        "INSERT INTO recurring_transactions
             (user_id, wallet_id, category_id, transaction_type, amount, frequency, start_date, next_due_date)
         VALUES ($1, $2, $3, 'EXPENSE', 1, 'daily', CURRENT_DATE, CURRENT_DATE) RETURNING id",
    )
    .bind(user_id)
    .bind(wallet)
    .bind(category)
    .fetch_one(&pool)
    .await
    .unwrap();
    let occurrence: Uuid = sqlx::query_scalar(
        "INSERT INTO recurring_occurrences (user_id, recurring_transaction_id, scheduled_for)
         VALUES ($1, $2, CURRENT_DATE) RETURNING id",
    )
    .bind(user_id)
    .bind(occurrence_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE transactions SET recurring_occurrence_id = $1 WHERE id = $2")
        .bind(occurrence)
        .bind(Uuid::parse_str(transaction_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let purged = app
        .oneshot(delete_permanently(&cookie, transaction_id))
        .await
        .unwrap();
    assert_eq!(purged.status(), StatusCode::NO_CONTENT);
    let occurrence_survives: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM recurring_occurrences WHERE id = $1)")
            .bind(occurrence)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        occurrence_survives,
        "permanent transaction deletion must not delete occurrence"
    );
}

#[sqlx::test(migrations = false)]
async fn purge_trash_command_deletes_only_expired_rows_within_batch_bound(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "transaction-purge@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = insert_wallet(&pool, user_id, "USD", false).await;
    let category = insert_category(&pool, user_id, "EXPENSE").await;
    let oldest = create_transaction(&app, &cookie, wallet, category, "1.00").await;
    let newest = create_transaction(&app, &cookie, wallet, category, "2.00").await;
    let active = create_transaction(&app, &cookie, wallet, category, "3.00").await;
    let oldest_id = Uuid::parse_str(oldest["id"].as_str().unwrap()).unwrap();
    let newest_id = Uuid::parse_str(newest["id"].as_str().unwrap()).unwrap();
    let active_id = Uuid::parse_str(active["id"].as_str().unwrap()).unwrap();
    sqlx::query(
        "UPDATE transactions
         SET deleted_at = now() - INTERVAL '31 days', purge_after = now() - INTERVAL '1 day'
         WHERE id = $1",
    )
    .bind(oldest_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE transactions
         SET deleted_at = now() - INTERVAL '30 days 1 hour', purge_after = now() - INTERVAL '1 hour'
         WHERE id = $1",
    )
    .bind(newest_id)
    .execute(&pool)
    .await
    .unwrap();

    let database_name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&pool)
        .await
        .unwrap();
    let base_database_url = std::env::var("DATABASE_URL").unwrap();
    let (database_url_prefix, _) = base_database_url.rsplit_once('/').unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_cashmemo-api"))
        .args(["purge-trash", "--batch-size", "1"])
        .env(
            "CASHMEMO_V1_DATABASE_URL",
            format!("{database_url_prefix}/{database_name}"),
        )
        .env("CASHMEMO_V1_APP_ENV", "test")
        .env("CASHMEMO_V1_PUBLIC_ORIGIN", "http://localhost:3000")
        .env("CASHMEMO_V1_SMTP_HOST", "localhost")
        .env("CASHMEMO_V1_SMTP_FROM", "test@example.test")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "purge command must succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let remaining: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM transactions ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(!remaining.contains(&oldest_id));
    assert!(remaining.contains(&newest_id));
    assert!(remaining.contains(&active_id));
}

#[sqlx::test(migrations = false)]
async fn hides_transactions_from_other_users_for_every_resource_route(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (owner_id, owner_cookie) =
        authenticated_user(&pool, "transaction-owner@example.test").await;
    let (_other_id, other_cookie) =
        authenticated_user(&pool, "transaction-other@example.test").await;
    let app = build_app(AppState { pool });
    let wallet = insert_wallet_from_app(&app, &owner_cookie, "USD").await;
    let category = insert_category_from_app(&app, &owner_cookie, "expense").await;
    let transaction = create_transaction(&app, &owner_cookie, wallet, category, "1.00").await;
    let transaction_id = transaction["id"].as_str().unwrap();
    assert_ne!(owner_id, Uuid::nil());

    for request in [
        get_transaction(&other_cookie, transaction_id),
        patch_transaction(&other_cookie, transaction_id, json!({ "note": "stolen" })),
        delete_transaction(&other_cookie, transaction_id),
        post_restore(&other_cookie, transaction_id),
        delete_permanently(&other_cookie, transaction_id),
    ] {
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
    }
}

async fn authenticated_user(pool: &PgPool, email: &str) -> (Uuid, String) {
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, status) VALUES ($1, 'hash', 'active') RETURNING id",
    )
    .bind(email)
    .fetch_one(pool)
    .await
    .unwrap();
    let token = format!("test-token-{user_id}");
    let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + INTERVAL '1 day')",
    )
    .bind(user_id)
    .bind(token_hash)
    .execute(pool)
    .await
    .unwrap();
    (user_id, format!("__Host-cashmemo_session={token}"))
}

async fn insert_wallet(pool: &PgPool, user_id: Uuid, currency: &str, archived: bool) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance, archived_at)
         VALUES ($1, $2, $3, 0, CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id",
    )
    .bind(user_id)
    .bind(format!("wallet-{}", Uuid::new_v4()))
    .bind(currency)
    .bind(archived)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn insert_category(pool: &PgPool, user_id: Uuid, kind: &str) -> Uuid {
    let name = format!("category-{}", Uuid::new_v4());
    sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, $2, $2, $3::transaction_type) RETURNING id",
    )
    .bind(user_id)
    .bind(name)
    .bind(kind)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn insert_transaction(
    pool: &PgPool,
    user_id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    occurred_at: DateTime<Utc>,
    deleted: bool,
) {
    let deleted_at = deleted.then(Utc::now);
    sqlx::query(
        "INSERT INTO transactions
         (user_id, wallet_id, category_id, transaction_type, amount, occurred_at, deleted_at, purge_after)
         VALUES ($1, $2, $3, 'EXPENSE', 1, $4, $5, CASE WHEN $5 IS NULL THEN NULL ELSE $5 + INTERVAL '30 days' END)",
    )
    .bind(user_id)
    .bind(wallet_id)
    .bind(category_id)
    .bind(occurred_at)
    .bind(deleted_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn create_transaction(
    app: &axum::Router,
    cookie: &str,
    wallet_id: Uuid,
    category_id: Uuid,
    amount: &str,
) -> Value {
    let response = app
        .clone()
        .oneshot(post_transaction(
            cookie,
            json!({ "wallet_id": wallet_id, "category_id": category_id, "direction": "expense", "amount": amount }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn insert_wallet_from_app(app: &axum::Router, cookie: &str, currency: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/wallets",
            cookie,
            Some(json!({ "name": "Cash", "currency": currency, "opening_balance": "0.00" })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    Uuid::parse_str(response_json(response).await["id"].as_str().unwrap()).unwrap()
}

async fn insert_category_from_app(app: &axum::Router, cookie: &str, kind: &str) -> Uuid {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/categories",
            cookie,
            Some(json!({ "name": "Food", "kind": kind })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    Uuid::parse_str(response_json(response).await["id"].as_str().unwrap()).unwrap()
}

fn post_transaction(cookie: &str, body: Value) -> Request<Body> {
    request("POST", "/api/v1/transactions", cookie, Some(body))
}

fn get_entry_defaults(cookie: &str) -> Request<Body> {
    request("GET", "/api/v1/transactions/entry-defaults", cookie, None)
}

fn get_transaction(cookie: &str, transaction_id: &str) -> Request<Body> {
    request(
        "GET",
        &format!("/api/v1/transactions/{transaction_id}"),
        cookie,
        None,
    )
}

fn patch_transaction(cookie: &str, transaction_id: &str, body: Value) -> Request<Body> {
    request(
        "PATCH",
        &format!("/api/v1/transactions/{transaction_id}"),
        cookie,
        Some(body),
    )
}

fn delete_transaction(cookie: &str, transaction_id: &str) -> Request<Body> {
    request(
        "DELETE",
        &format!("/api/v1/transactions/{transaction_id}"),
        cookie,
        None,
    )
}

fn post_restore(cookie: &str, transaction_id: &str) -> Request<Body> {
    request(
        "POST",
        &format!("/api/v1/transactions/{transaction_id}/restore"),
        cookie,
        None,
    )
}

fn delete_permanently(cookie: &str, transaction_id: &str) -> Request<Body> {
    request(
        "DELETE",
        &format!("/api/v1/transactions/{transaction_id}/permanent"),
        cookie,
        None,
    )
}

fn request(method: &str, uri: &str, cookie: &str, body: Option<Value>) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000");
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    builder
        .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
        .unwrap()
}

fn parse_instant(value: &Value) -> DateTime<Utc> {
    value.as_str().unwrap().parse().unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
