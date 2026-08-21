mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use cashmemo_api::recurring::{ProcessOptions, RecurringProcessor};
use chrono::Utc;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn creates_daily_recurring_transaction_with_first_due_date_at_or_after_today(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "recurring-create@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let app = build_app(AppState { pool: pool.clone() });
    let start_date = "2000-01-01";

    let response = app
        .oneshot(post_recurring(
            &cookie,
            json!({
                "wallet_id": wallet_id,
                "category_id": category_id,
                "direction": "expense",
                "amount": "12.50",
                "frequency": "daily",
                "start_date": start_date,
                "note": "rent"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    assert_eq!(body["wallet_id"], wallet_id.to_string());
    assert_eq!(body["category_id"], category_id.to_string());
    assert_eq!(body["direction"], "expense");
    assert_eq!(body["amount"], "12.50");
    assert_eq!(body["frequency"], "daily");
    assert_eq!(body["start_date"], start_date);
    assert_eq!(body["next_due_date"], Utc::now().date_naive().to_string());

    let occurrences: i64 = sqlx::query_scalar("SELECT count(*) FROM recurring_occurrences")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(occurrences, 0);
}

#[sqlx::test(migrations = false)]
async fn processor_creates_each_due_occurrence_once_and_bounds_catch_up(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "recurring-process@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let app = build_app(AppState { pool: pool.clone() });
    let response = app.oneshot(post_recurring(&cookie, json!({"wallet_id": wallet_id, "category_id": category_id, "direction":"expense", "amount":"12.50", "frequency":"daily", "start_date":"2000-01-01"}))).await.unwrap();
    let rule = json_body(response).await;
    let rule_id = Uuid::parse_str(rule["id"].as_str().unwrap()).unwrap();
    let today = Utc::now().date_naive();
    sqlx::query("UPDATE recurring_transactions SET next_due_date=$2 WHERE id=$1")
        .bind(rule_id)
        .bind(today - chrono::Days::new(2))
        .execute(&pool)
        .await
        .unwrap();

    let processor = RecurringProcessor::new(pool.clone());
    let first = processor
        .process(ProcessOptions {
            batch_size: 10,
            max_occurrences_per_recurring_transaction: 2,
        })
        .await
        .unwrap();
    assert_eq!(first.generated, 2);
    let second = processor
        .process(ProcessOptions {
            batch_size: 10,
            max_occurrences_per_recurring_transaction: 2,
        })
        .await
        .unwrap();
    assert_eq!(second.generated, 1);
    let third = processor
        .process(ProcessOptions {
            batch_size: 10,
            max_occurrences_per_recurring_transaction: 2,
        })
        .await
        .unwrap();
    assert_eq!(third.generated, 0);
    let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM recurring_occurrences WHERE recurring_transaction_id=$1), (SELECT count(*) FROM transactions WHERE recurring_occurrence_id IS NOT NULL)").bind(rule_id).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (3, 3));
}

async fn authenticated_user(pool: &PgPool, email: &str) -> (Uuid, String) {
    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, status, email_verified, timezone)
         VALUES ($1, $2, 'hash', 'active', TRUE, 'Etc/UTC')",
    )
    .bind(user_id)
    .bind(email)
    .execute(pool)
    .await
    .unwrap();
    let raw_token = format!("test-token-{user_id}");
    let token_hash = format!("{:x}", Sha256::digest(raw_token.as_bytes()));
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + INTERVAL '1 day')",
    )
    .bind(user_id)
    .bind(token_hash)
    .execute(pool)
    .await
    .unwrap();
    (user_id, format!("__Host-cashmemo_session={raw_token}"))
}

async fn owned_references(pool: &PgPool, user_id: Uuid) -> (Uuid, Uuid) {
    let wallet_id: Uuid = sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Main', 'USD', 0) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let category_id: Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Bills', 'bills', 'EXPENSE') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (wallet_id, category_id)
}

fn post_recurring(cookie: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/v1/recurring-transactions")
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
