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
async fn monthly_summary_partitions_currency_and_aggregates_exact_decimal_strings(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    let (user_id, cookie) =
        authenticated_user(&pool, "reporting@example.test", "America/New_York").await;
    let food = insert_category(&pool, user_id, "EXPENSE", "Food").await;
    let travel = insert_category(&pool, user_id, "EXPENSE", "Travel").await;
    let salary = insert_category(&pool, user_id, "INCOME", "Salary").await;
    let usd = insert_wallet(&pool, user_id, "USD").await;
    let eur = insert_wallet(&pool, user_id, "EUR").await;

    // 2026-04 in New York is [2026-04-01T04:00Z, 2026-05-01T04:00Z).
    insert_transaction(
        &pool,
        user_id,
        usd,
        salary,
        "INCOME",
        "100.00",
        "2026-04-01T04:00:00Z",
        None,
    )
    .await;
    sqlx::query(
        "INSERT INTO recurring_transactions
             (user_id, wallet_id, category_id, transaction_type, amount, frequency, start_date, next_due_date)
         VALUES ($1, $2, $3, 'EXPENSE', 900.00, 'monthly', DATE '2026-04-01', DATE '2026-04-01')",
    )
    .bind(user_id)
    .bind(usd)
    .bind(food)
    .execute(&pool)
    .await
    .unwrap();
    insert_transaction(
        &pool,
        user_id,
        usd,
        food,
        "EXPENSE",
        "12.50",
        "2026-04-10T12:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd,
        food,
        "EXPENSE",
        "7.25",
        "2026-04-11T12:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd,
        travel,
        "EXPENSE",
        "20.00",
        "2026-04-12T12:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        eur,
        food,
        "EXPENSE",
        "8.00",
        "2026-04-12T12:00:00Z",
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd,
        food,
        "EXPENSE",
        "999.00",
        "2026-04-15T12:00:00Z",
        Some(Utc::now()),
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        usd,
        food,
        "EXPENSE",
        "1.00",
        "2026-05-01T03:59:59Z",
        None,
    )
    .await;

    let response = get(
        &app,
        &cookie,
        "/api/v1/reports/monthly-summary?month=2026-04",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        json!({
            "month": "2026-04",
            "currencies": [
                {
                    "currency": "EUR", "income": "0.00", "expense": "8.00", "net": "-8.00",
                    "expense_categories": [{ "category_id": food, "name": "Food", "expense": "8.00" }]
                },
                {
                    "currency": "USD", "income": "100.00", "expense": "40.75", "net": "59.25",
                    "expense_categories": [
                        { "category_id": food, "name": "Food", "expense": "20.75" },
                        { "category_id": travel, "name": "Travel", "expense": "20.00" }
                    ]
                }
            ]
        })
    );
}

#[sqlx::test(migrations = false)]
async fn monthly_summary_defaults_using_user_timezone_and_excludes_future_transactions(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    let (user_id, cookie) =
        authenticated_user(&pool, "now@example.test", "Pacific/Kiritimati").await;
    let category = insert_category(&pool, user_id, "EXPENSE", "Food").await;
    let wallet = insert_wallet(&pool, user_id, "USD").await;
    let now = Utc::now();
    insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "EXPENSE",
        "1.25",
        &(now - Duration::minutes(1)).to_rfc3339(),
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "EXPENSE",
        "2.50",
        &(now + Duration::minutes(1)).to_rfc3339(),
        None,
    )
    .await;

    let response = get(&app, &cookie, "/api/v1/reports/monthly-summary").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(
        body["month"],
        now.with_timezone(&chrono_tz::Pacific::Kiritimati)
            .format("%Y-%m")
            .to_string()
    );
    assert_eq!(body["currencies"][0]["expense"], "1.25");
}

#[sqlx::test(migrations = false)]
async fn recent_transactions_are_active_current_and_owned_but_history_keeps_future(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let app = build_app(AppState { pool: pool.clone() });
    let (user_id, cookie) = authenticated_user(&pool, "recent@example.test", "UTC").await;
    let (other_user, _other_cookie) =
        authenticated_user(&pool, "recent-other@example.test", "UTC").await;
    let category = insert_category(&pool, user_id, "EXPENSE", "Food").await;
    let wallet = insert_wallet(&pool, user_id, "USD").await;
    let other_category = insert_category(&pool, other_user, "EXPENSE", "Food").await;
    let other_wallet = insert_wallet(&pool, other_user, "USD").await;
    insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "EXPENSE",
        "1.00",
        &(Utc::now() - Duration::minutes(3)).to_rfc3339(),
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "EXPENSE",
        "2.00",
        &(Utc::now() + Duration::days(1)).to_rfc3339(),
        None,
    )
    .await;
    insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "EXPENSE",
        "3.00",
        &(Utc::now() - Duration::minutes(2)).to_rfc3339(),
        Some(Utc::now()),
    )
    .await;
    insert_transaction(
        &pool,
        other_user,
        other_wallet,
        other_category,
        "EXPENSE",
        "4.00",
        &(Utc::now() - Duration::minutes(1)).to_rfc3339(),
        None,
    )
    .await;

    let recent = get(&app, &cookie, "/api/v1/transactions/recent").await;
    assert_eq!(recent.status(), StatusCode::OK);
    let recent = response_json(recent).await;
    assert_eq!(recent["items"].as_array().unwrap().len(), 1);
    assert_eq!(recent["items"][0]["amount"], "1.00");

    let history = get(&app, &cookie, "/api/v1/transactions").await;
    assert_eq!(history.status(), StatusCode::OK);
    assert_eq!(
        response_json(history).await["items"]
            .as_array()
            .unwrap()
            .len(),
        2,
        "future transactions remain visible in history"
    );

    sqlx::query("UPDATE users SET status = 'pending_deletion' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        get(&app, &cookie, "/api/v1/reports/monthly-summary")
            .await
            .status(),
        StatusCode::FORBIDDEN,
        "reporting reads require a full-access session"
    );
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
    sqlx::query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')")
        .bind(user_id).bind(token_hash).execute(pool).await.unwrap();
    (user_id, format!("__Host-cashmemo_session={token}"))
}

async fn insert_category(pool: &PgPool, user_id: Uuid, kind: &str, name: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type) VALUES ($1, $2, lower($2), $3::transaction_type) RETURNING id",
    )
    .bind(user_id).bind(name).bind(kind).fetch_one(pool).await.unwrap()
}

async fn insert_wallet(pool: &PgPool, user_id: Uuid, currency: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code) VALUES ($1, $2, $3) RETURNING id",
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
    deleted_at: Option<chrono::DateTime<Utc>>,
) {
    sqlx::query(
        "INSERT INTO transactions (user_id, wallet_id, category_id, transaction_type, amount, occurred_at, deleted_at, purge_after)
         VALUES ($1, $2, $3, $4::transaction_type, $5::numeric, $6::timestamptz, $7, CASE WHEN $7 IS NULL THEN NULL ELSE $7 + interval '30 days' END)",
    )
    .bind(user_id).bind(wallet_id).bind(category_id).bind(direction).bind(amount).bind(occurred_at).bind(deleted_at)
    .execute(pool).await.unwrap();
}

async fn get(app: &axum::Router, cookie: &str, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header(header::COOKIE, cookie)
                .header(header::ORIGIN, "http://localhost:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
