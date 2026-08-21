mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn creates_wallet_at_exact_name_limit_with_enabled_currency_and_opening_balance(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "wallet-create@example.test").await;
    let app = build_app(AppState { pool });
    let name = "🪨".repeat(80);

    let response = app
        .oneshot(post_wallet(
            &cookie,
            json!({ "name": name, "currency": "USD", "opening_balance": "12.34" }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response_json(response).await;
    assert_eq!(body["name"], name);
    assert_eq!(body["currency"], "USD");
    assert_eq!(body["opening_balance"], "12.34");
    assert_eq!(body["balance"]["currency"], "USD");
    assert_eq!(body["balance"]["amount"], "12.34");
    assert!(body["balance"]["as_of"].is_string());
}

#[sqlx::test(migrations = false)]
async fn rejects_wallet_names_outside_trimmed_code_point_limit(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "wallet-name@example.test").await;
    let app = build_app(AppState { pool });

    for name in ["   ".to_owned(), "🪨".repeat(81)] {
        let response = app
            .clone()
            .oneshot(post_wallet(
                &cookie,
                json!({ "name": name, "currency": "USD", "opening_balance": "0.00" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}

#[sqlx::test(migrations = false)]
async fn rejects_disabled_currency_and_invalid_opening_balance_before_persistence(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "wallet-validation@example.test").await;
    sqlx::query("UPDATE currencies SET enabled = FALSE WHERE code = 'EUR'")
        .execute(&pool)
        .await
        .unwrap();
    let app = build_app(AppState { pool: pool.clone() });

    for body in [
        json!({ "name": "Cash", "currency": "EUR", "opening_balance": "0.00" }),
        json!({ "name": "Cash", "currency": "USD", "opening_balance": "-0.01" }),
        json!({ "name": "Cash", "currency": "USD", "opening_balance": "1.234" }),
    ] {
        let response = app
            .clone()
            .oneshot(post_wallet(&cookie, body))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let wallet_count: i64 = sqlx::query_scalar("SELECT count(*) FROM wallets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(wallet_count, 0);
}

#[sqlx::test(migrations = false)]
async fn updates_name_but_rejects_immutable_currency_and_opening_balance(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "wallet-update@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = create_wallet(&app, &cookie, "Cash", "USD", "10.00").await;
    let wallet_id = wallet["id"].as_str().unwrap();

    let updated = app
        .clone()
        .oneshot(patch_wallet(
            &cookie,
            wallet_id,
            json!({ "name": "Pocket" }),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let body = response_json(updated).await;
    assert_eq!(body["name"], "Pocket");
    assert_eq!(body["opening_balance"], "10.00");

    for immutable_field in [
        json!({ "currency": "EUR" }),
        json!({ "opening_balance": "20.00" }),
    ] {
        let rejected = app
            .clone()
            .oneshot(patch_wallet(&cookie, wallet_id, immutable_field))
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
    let stored: (String, rust_decimal::Decimal) =
        sqlx::query_as("SELECT currency_code, opening_balance FROM wallets WHERE id = $1")
            .bind(Uuid::parse_str(wallet_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored.0, "USD");
    assert_eq!(stored.1.to_string(), "10.0000");
}

#[sqlx::test(migrations = false)]
async fn archive_and_restore_preserve_transaction_history(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "wallet-archive@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = create_wallet(&app, &cookie, "Cash", "USD", "0.00").await;
    let wallet_id = wallet["id"].as_str().unwrap();
    insert_transaction(
        &pool,
        user_id,
        wallet_id,
        "INCOME",
        "5.00",
        Utc::now(),
        false,
    )
    .await;

    let archived = app
        .clone()
        .oneshot(post_archive(&cookie, wallet_id))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    assert!(response_json(archived).await["archived_at"].is_string());
    let history_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM transactions WHERE wallet_id = $1")
            .bind(Uuid::parse_str(wallet_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(history_count, 1);

    let listed = app.clone().oneshot(get_wallets(&cookie)).await.unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(response_json(listed).await.as_array().unwrap().len(), 1);

    let restored = app.oneshot(post_restore(&cookie, wallet_id)).await.unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
    assert!(response_json(restored).await["archived_at"].is_null());
}

#[sqlx::test(migrations = false)]
async fn blocks_wallet_deletion_when_history_or_recurring_references_exist(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "wallet-delete@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = create_wallet(&app, &cookie, "Cash", "USD", "0.00").await;
    let wallet_id = wallet["id"].as_str().unwrap();
    insert_transaction(
        &pool,
        user_id,
        wallet_id,
        "EXPENSE",
        "5.00",
        Utc::now(),
        true,
    )
    .await;

    let deleted = app
        .clone()
        .oneshot(delete_wallet(&cookie, wallet_id))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::CONFLICT);
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM wallets WHERE id = $1)")
        .bind(Uuid::parse_str(wallet_id).unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(exists);

    sqlx::query("DELETE FROM transactions WHERE wallet_id = $1")
        .bind(Uuid::parse_str(wallet_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let category_id: Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Bills', 'bills', 'EXPENSE') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO recurring_transactions
         (user_id, wallet_id, category_id, transaction_type, amount, frequency, start_date, next_due_date)
         VALUES ($1, $2, $3, 'EXPENSE', 1.00, 'daily', CURRENT_DATE, CURRENT_DATE)",
    )
    .bind(user_id)
    .bind(Uuid::parse_str(wallet_id).unwrap())
    .bind(category_id)
    .execute(&pool)
    .await
    .unwrap();
    let recurring_blocked = app
        .oneshot(delete_wallet(&cookie, wallet_id))
        .await
        .unwrap();
    assert_eq!(recurring_blocked.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = false)]
async fn deletes_wallet_without_references(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "wallet-delete-empty@example.test").await;
    let app = build_app(AppState { pool });
    let wallet = create_wallet(&app, &cookie, "Cash", "USD", "0.00").await;
    let wallet_id = wallet["id"].as_str().unwrap();

    let deleted = app
        .clone()
        .oneshot(delete_wallet(&cookie, wallet_id))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let missing = app.oneshot(get_wallet(&cookie, wallet_id)).await.unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = false)]
async fn hides_wallets_from_other_users_for_all_lifecycle_routes(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_owner_id, owner_cookie) = authenticated_user(&pool, "wallet-owner@example.test").await;
    let (_other_id, other_cookie) = authenticated_user(&pool, "wallet-other@example.test").await;
    let app = build_app(AppState { pool });
    let wallet = create_wallet(&app, &owner_cookie, "Cash", "USD", "0.00").await;
    let wallet_id = wallet["id"].as_str().unwrap();

    let listed = app
        .clone()
        .oneshot(get_wallets(&other_cookie))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(response_json(listed).await, json!([]));

    for request in [
        get_wallet(&other_cookie, wallet_id),
        patch_wallet(&other_cookie, wallet_id, json!({ "name": "Stolen" })),
        post_archive(&other_cookie, wallet_id),
        post_restore(&other_cookie, wallet_id),
        delete_wallet(&other_cookie, wallet_id),
    ] {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

#[sqlx::test(migrations = false)]
async fn current_balance_uses_only_active_transactions_due_by_now(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "wallet-balance@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let wallet = create_wallet(&app, &cookie, "Cash", "USD", "100.00").await;
    let wallet_id = wallet["id"].as_str().unwrap();
    insert_transaction(
        &pool,
        user_id,
        wallet_id,
        "INCOME",
        "25.00",
        Utc::now() - Duration::days(1),
        false,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        wallet_id,
        "EXPENSE",
        "10.00",
        Utc::now() - Duration::hours(1),
        false,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        wallet_id,
        "INCOME",
        "500.00",
        Utc::now() + Duration::days(1),
        false,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        wallet_id,
        "EXPENSE",
        "70.00",
        Utc::now() - Duration::minutes(1),
        true,
    )
    .await;

    let response = app.oneshot(get_wallet(&cookie, wallet_id)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(
        body["balance"],
        json!({
            "currency": "USD",
            "amount": "115.00",
            "as_of": body["balance"]["as_of"],
        })
    );
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

async fn create_wallet(
    app: &axum::Router,
    cookie: &str,
    name: &str,
    currency: &str,
    opening_balance: &str,
) -> Value {
    let response = app
        .clone()
        .oneshot(post_wallet(
            cookie,
            json!({ "name": name, "currency": currency, "opening_balance": opening_balance }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn insert_transaction(
    pool: &PgPool,
    user_id: Uuid,
    wallet_id: &str,
    transaction_type: &str,
    amount: &str,
    occurred_at: chrono::DateTime<Utc>,
    deleted: bool,
) {
    let category_id: Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, $2, $3, $4::transaction_type) RETURNING id",
    )
    .bind(user_id)
    .bind(format!("category-{amount}-{deleted}"))
    .bind(format!("category-{amount}-{deleted}"))
    .bind(transaction_type)
    .fetch_one(pool)
    .await
    .unwrap();
    let deleted_at = deleted.then(Utc::now);
    sqlx::query(
        "INSERT INTO transactions
         (user_id, wallet_id, category_id, transaction_type, amount, occurred_at, deleted_at, purge_after)
         VALUES ($1, $2, $3, $4::transaction_type, $5::NUMERIC, $6, $7, CASE WHEN $7 IS NULL THEN NULL ELSE $7 + INTERVAL '30 days' END)",
    )
    .bind(user_id)
    .bind(Uuid::parse_str(wallet_id).unwrap())
    .bind(category_id)
    .bind(transaction_type)
    .bind(amount)
    .bind(occurred_at)
    .bind(deleted_at)
    .execute(pool)
    .await
    .unwrap();
}

fn post_wallet(cookie: &str, body: Value) -> Request<Body> {
    request("POST", "/api/v1/wallets", cookie, Some(body))
}

fn get_wallet(cookie: &str, wallet_id: &str) -> Request<Body> {
    request("GET", &format!("/api/v1/wallets/{wallet_id}"), cookie, None)
}

fn get_wallets(cookie: &str) -> Request<Body> {
    request("GET", "/api/v1/wallets", cookie, None)
}

fn patch_wallet(cookie: &str, wallet_id: &str, body: Value) -> Request<Body> {
    request(
        "PATCH",
        &format!("/api/v1/wallets/{wallet_id}"),
        cookie,
        Some(body),
    )
}

fn post_archive(cookie: &str, wallet_id: &str) -> Request<Body> {
    request(
        "POST",
        &format!("/api/v1/wallets/{wallet_id}/archive"),
        cookie,
        None,
    )
}

fn post_restore(cookie: &str, wallet_id: &str) -> Request<Body> {
    request(
        "POST",
        &format!("/api/v1/wallets/{wallet_id}/restore"),
        cookie,
        None,
    )
}

fn delete_wallet(cookie: &str, wallet_id: &str) -> Request<Body> {
    request(
        "DELETE",
        &format!("/api/v1/wallets/{wallet_id}"),
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

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
