mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn budget_summary_derives_active_expense_spending_by_local_month_category_and_wallet_currency(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    let (user_id, cookie) =
        authenticated_user(&pool, "budget@example.test", "America/New_York").await;
    let food = insert_category(&pool, user_id, "expense").await;
    let travel = insert_category(&pool, user_id, "expense").await;
    let salary = insert_category(&pool, user_id, "income").await;
    let usd_wallet = insert_wallet(&pool, user_id, "USD").await;
    let eur_wallet = insert_wallet(&pool, user_id, "EUR").await;

    let budget = create_budget(&app, &cookie, food, "USD", "2026-04", "100.00").await;
    assert_eq!(budget["amount"], "100.00");

    insert_transaction(
        &pool,
        user_id,
        usd_wallet,
        food,
        "expense",
        "12.50",
        "2026-04-01T04:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd_wallet,
        food,
        "expense",
        "20.25",
        "2026-05-01T03:59:59Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd_wallet,
        salary,
        "income",
        "99.00",
        "2026-04-15T12:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd_wallet,
        travel,
        "expense",
        "40.00",
        "2026-04-15T12:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        eur_wallet,
        food,
        "expense",
        "30.00",
        "2026-04-15T12:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd_wallet,
        food,
        "expense",
        "7.25",
        "2026-04-15T12:00:00Z",
        Some(Utc::now()),
    )
    .await;

    let summary = get_summary(&app, &cookie, "2026-04").await;
    assert_eq!(
        summary,
        json!({
            "month": "2026-04",
            "budgets": [{
                "id": budget["id"],
                "category_id": food,
                "currency": "USD",
                "budgeted": "100.00",
                "spent": "32.75",
                "remaining": "67.25",
                "progress": "32.75"
            }]
        })
    );
}

#[sqlx::test(migrations = false)]
async fn budget_read_rejects_persisted_corrupt_scale_instead_of_rounding(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) =
        authenticated_user(&pool, "budget-corrupt-scale@example.test", "UTC").await;
    let category = insert_category(&pool, user_id, "expense").await;
    sqlx::query(
        "INSERT INTO budgets (user_id, category_id, currency_code, month_start, amount)
         VALUES ($1, $2, 'USD', DATE '2026-01-01', 1.231)",
    )
    .bind(user_id)
    .bind(category)
    .execute(&pool)
    .await
    .unwrap();

    let app = build_app(AppState { pool });
    let response = app
        .oneshot(request(
            "GET",
            "/api/v1/budgets?month=2026-01",
            &cookie,
            None,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[sqlx::test(migrations = false)]
async fn budget_summary_recalculates_after_transaction_updates_trash_restore_and_permanent_delete(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    let (user_id, cookie) = authenticated_user(&pool, "movement@example.test", "UTC").await;
    let food = insert_category(&pool, user_id, "expense").await;
    let travel = insert_category(&pool, user_id, "expense").await;
    let usd_wallet = insert_wallet(&pool, user_id, "USD").await;
    let eur_wallet = insert_wallet(&pool, user_id, "EUR").await;
    create_budget(&app, &cookie, food, "USD", "2026-03", "10.00").await;
    create_budget(&app, &cookie, travel, "EUR", "2026-04", "10.00").await;

    let transaction =
        create_transaction(&app, &cookie, usd_wallet, food, "1.50", "2026-03-31T23:00").await;
    assert_eq!(summary_spent(&app, &cookie, "2026-03").await, "1.50");

    let moved = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!(
                "/api/v1/transactions/{}",
                transaction["id"].as_str().unwrap()
            ),
            &cookie,
            Some(json!({
                "wallet_id": eur_wallet,
                "category_id": travel,
                "occurred_local": "2026-04-01T00:00"
            })),
        ))
        .await
        .unwrap();
    assert!(moved.status().is_success());
    assert_eq!(summary_spent(&app, &cookie, "2026-03").await, "0.00");
    assert_eq!(summary_spent(&app, &cookie, "2026-04").await, "1.50");

    let id = transaction["id"].as_str().unwrap();
    for (method, uri, expected) in [
        ("DELETE", format!("/api/v1/transactions/{id}"), "0.00"),
        ("POST", format!("/api/v1/transactions/{id}/restore"), "1.50"),
        ("DELETE", format!("/api/v1/transactions/{id}"), "0.00"),
        (
            "DELETE",
            format!("/api/v1/transactions/{id}/permanent"),
            "0.00",
        ),
    ] {
        let response = app
            .clone()
            .oneshot(request(method, &uri, &cookie, None))
            .await
            .unwrap();
        assert!(response.status().is_success());
        assert_eq!(summary_spent(&app, &cookie, "2026-04").await, expected);
    }
}

#[sqlx::test(migrations = false)]
async fn budget_summary_excludes_future_expenses(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    let (user_id, cookie) = authenticated_user(&pool, "future@example.test", "UTC").await;
    let food = insert_category(&pool, user_id, "expense").await;
    let wallet = insert_wallet(&pool, user_id, "USD").await;
    let month = Utc::now().format("%Y-%m").to_string();
    create_budget(&app, &cookie, food, "USD", &month, "10.00").await;
    let future = (Utc::now() + chrono::Duration::days(1)).to_rfc3339();
    insert_transaction(
        &pool, user_id, wallet, food, "expense", "1.00", &future, None,
    )
    .await;

    assert_eq!(summary_spent(&app, &cookie, &month).await, "0.00");
}

#[sqlx::test(migrations = false)]
async fn budget_crud_enforces_month_category_currency_uniqueness_and_user_ownership(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    let (user_id, cookie) = authenticated_user(&pool, "owner@example.test", "UTC").await;
    let food = insert_category(&pool, user_id, "expense").await;
    let first = create_budget(&app, &cookie, food, "USD", "2026-08", "5.00").await;

    let duplicate = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/budgets",
            &cookie,
            Some(json!({ "category_id": food, "currency": "USD", "month": "2026-08", "amount": "6.00" })),
        ))
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let updated = response_json(
        app.clone()
            .oneshot(request(
                "PATCH",
                &format!("/api/v1/budgets/{}", first["id"].as_str().unwrap()),
                &cookie,
                Some(json!({ "amount": "12.34" })),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(updated["amount"], "12.34");

    let incompatible_currency = app
        .clone()
        .oneshot(request(
            "PATCH",
            &format!("/api/v1/budgets/{}", first["id"].as_str().unwrap()),
            &cookie,
            Some(json!({ "currency": "IDR" })),
        ))
        .await
        .unwrap();
    assert_eq!(
        incompatible_currency.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let whole_amount = response_json(
        app.clone()
            .oneshot(request(
                "PATCH",
                &format!("/api/v1/budgets/{}", first["id"].as_str().unwrap()),
                &cookie,
                Some(json!({ "amount": "12" })),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(whole_amount["amount"], "12.00");
    let idr = response_json(
        app.clone()
            .oneshot(request(
                "PATCH",
                &format!("/api/v1/budgets/{}", first["id"].as_str().unwrap()),
                &cookie,
                Some(json!({ "currency": "IDR" })),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(idr["currency"], "IDR");
    assert_eq!(idr["amount"], "12");

    let other_user = authenticated_user(&pool, "other@example.test", "UTC")
        .await
        .1;
    let hidden = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!("/api/v1/budgets/{}", first["id"].as_str().unwrap()),
            &other_user,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::NOT_FOUND);

    let deleted = app
        .oneshot(request(
            "DELETE",
            &format!("/api/v1/budgets/{}", first["id"].as_str().unwrap()),
            &cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
}

#[sqlx::test(migrations = false)]
async fn budget_summary_resolves_ambiguous_and_nonexistent_midnight_month_boundaries(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    for (email, timezone, month) in [
        ("havana@example.test", "America/Havana", "2020-11"),
        ("asuncion@example.test", "America/Asuncion", "2000-10"),
        ("new-york@example.test", "America/New_York", "2026-03"),
    ] {
        let (user_id, cookie) = authenticated_user(&pool, email, timezone).await;
        let category = insert_category(&pool, user_id, "expense").await;
        create_budget(&app, &cookie, category, "USD", month, "1.00").await;
        assert_eq!(
            get_summary(&app, &cookie, month).await["budgets"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}

async fn authenticated_user(pool: &PgPool, email: &str, timezone: &str) -> (Uuid, String) {
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, status, timezone) VALUES ($1, 'hash', 'active', $2) RETURNING id",
    )
    .bind(email)
    .bind(timezone)
    .fetch_one(pool)
    .await
    .unwrap();
    let token = format!("test-token-{user_id}");
    let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')",
    )
    .bind(user_id)
    .bind(token_hash)
    .execute(pool)
    .await
    .unwrap();
    (user_id, format!("__Host-cashmemo_session={token}"))
}

async fn insert_category(pool: &PgPool, user_id: Uuid, kind: &str) -> Uuid {
    let name = format!("category-{}", Uuid::new_v4());
    sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)\
         VALUES ($1, $2, $2, $3::transaction_type) RETURNING id",
    )
    .bind(user_id)
    .bind(name)
    .bind(kind.to_uppercase())
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn insert_wallet(pool: &PgPool, user_id: Uuid, currency: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)\
         VALUES ($1, $2, $3, 0) RETURNING id",
    )
    .bind(user_id)
    .bind(format!("wallet-{}", Uuid::new_v4()))
    .bind(currency)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn insert_transaction(
    pool: &PgPool,
    user_id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    direction: &str,
    amount: &str,
    occurred_at: &str,
    deleted_at: Option<DateTime<Utc>>,
) {
    sqlx::query(
        "INSERT INTO transactions\
         (user_id, wallet_id, category_id, transaction_type, amount, occurred_at, deleted_at, purge_after)\
         VALUES ($1, $2, $3, $4::transaction_type, $5::numeric, $6::timestamptz, $7,\
                 CASE WHEN $7 IS NULL THEN NULL ELSE $7 + INTERVAL '30 days' END)",
    )
    .bind(user_id)
    .bind(wallet_id)
    .bind(category_id)
    .bind(direction.to_uppercase())
    .bind(amount)
    .bind(occurred_at)
    .bind(deleted_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn create_budget(
    app: &axum::Router,
    cookie: &str,
    category_id: Uuid,
    currency: &str,
    month: &str,
    amount: &str,
) -> Value {
    let response = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/budgets",
            cookie,
            Some(json!({ "category_id": category_id, "currency": currency, "month": month, "amount": amount })),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn create_transaction(
    app: &axum::Router,
    cookie: &str,
    wallet_id: Uuid,
    category_id: Uuid,
    amount: &str,
    occurred_local: &str,
) -> Value {
    response_json(
        app.clone()
            .oneshot(request(
                "POST",
                "/api/v1/transactions",
                cookie,
                Some(json!({ "wallet_id": wallet_id, "category_id": category_id, "direction": "expense", "amount": amount, "occurred_local": occurred_local })),
            ))
            .await
            .unwrap(),
    )
    .await
}

async fn get_summary(app: &axum::Router, cookie: &str, month: &str) -> Value {
    let response = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/api/v1/reports/budget-summary?month={month}"),
            cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response_json(response).await
}

async fn summary_spent(app: &axum::Router, cookie: &str, month: &str) -> Value {
    get_summary(app, cookie, month).await["budgets"][0]["spent"].clone()
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
        .body(
            body.map(|value| Body::from(value.to_string()))
                .unwrap_or_default(),
        )
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
