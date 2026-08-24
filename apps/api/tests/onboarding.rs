mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const EXPECTED_STARTER_COUNT: i64 = 18;

#[sqlx::test(migrations = false)]
async fn onboarding_state_is_derived_from_persisted_preferences_categories_and_wallets(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "onboarding-state@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });

    let response = app.clone().oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        json!({
            "timezone_configured": false,
            "timezone": null,
            "default_currency_configured": false,
            "default_currency_code": null,
            "categories_seeded": false,
            "has_active_wallet": false,
        })
    );

    sqlx::query(
        "UPDATE users
         SET timezone = 'Asia/Jakarta', timezone_configured_at = now(), default_currency_code = 'IDR'
         WHERE id = $1",
    )
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type, starter_key)
         VALUES ($1, 'Food & Drink', 'food & drink', 'EXPENSE', 'starter_expense_food_drink')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Cash', 'IDR', 0)",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let response = app.oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_json(response).await,
        json!({
            "timezone_configured": true,
            "timezone": "Asia/Jakarta",
            "default_currency_configured": true,
            "default_currency_code": "IDR",
            "categories_seeded": false,
            "has_active_wallet": true,
        })
    );
}

#[sqlx::test(migrations = false)]
async fn preferences_reject_invalid_iana_timezones_and_unsupported_currencies(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "preferences@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });

    let invalid_timezone = app
        .clone()
        .oneshot(put_preferences(
            &cookie,
            json!({
                "timezone": "Mars/Olympus",
                "default_currency_code": "USD",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(invalid_timezone.status(), StatusCode::UNPROCESSABLE_ENTITY);

    sqlx::query("UPDATE currencies SET enabled = FALSE WHERE code = 'EUR'")
        .execute(&pool)
        .await
        .unwrap();
    let unsupported_currency = app
        .clone()
        .oneshot(put_preferences(
            &cookie,
            json!({
                "timezone": "Asia/Jakarta",
                "default_currency_code": "EUR",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(
        unsupported_currency.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let updated = app
        .oneshot(put_preferences(
            &cookie,
            json!({
                "timezone": "Asia/Jakarta",
                "default_currency_code": "IDR",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = response_json(updated).await;
    assert_eq!(updated["timezone_configured"], true);
    assert_eq!(updated["timezone"], "Asia/Jakarta");
    let stored: (String, Option<String>) =
        sqlx::query_as("SELECT timezone, default_currency_code FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, ("Asia/Jakarta".to_owned(), Some("IDR".to_owned())));
}

#[sqlx::test(migrations = false)]
async fn starter_key_provenance_cannot_be_reassigned(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "starter-provenance@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let seeded = app.oneshot(seed_categories(&cookie)).await.unwrap();
    assert_eq!(seeded.status(), StatusCode::OK);

    let result = sqlx::query(
        "UPDATE categories
         SET starter_key = 'starter_expense_reassigned'
         WHERE user_id = $1 AND starter_key = 'starter_expense_food_drink'",
    )
    .bind(user_id)
    .execute(&pool)
    .await;
    assert!(result.is_err(), "starter provenance must be immutable");
}

#[sqlx::test(migrations = false)]
async fn category_seeding_is_idempotent_for_repeated_and_concurrent_requests(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "category-seeding@example.test").await;
    sqlx::query(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Personal', 'personal', 'EXPENSE')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let app = build_app(AppState { pool: pool.clone() });

    let (first, second) = tokio::join!(
        app.clone().oneshot(seed_categories(&cookie)),
        app.clone().oneshot(seed_categories(&cookie)),
    );
    assert_eq!(first.unwrap().status(), StatusCode::OK);
    assert_eq!(second.unwrap().status(), StatusCode::OK);
    let repeated = app.clone().oneshot(seed_categories(&cookie)).await.unwrap();
    assert_eq!(repeated.status(), StatusCode::OK);

    let starter_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM categories WHERE user_id = $1 AND starter_key IS NOT NULL",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let custom_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM categories WHERE user_id = $1 AND starter_key IS NULL",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(starter_count, EXPECTED_STARTER_COUNT);
    assert_eq!(custom_count, 1);

    let state = app.oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(state.status(), StatusCode::OK);
    assert_eq!(response_json(state).await["categories_seeded"], true);
}

#[sqlx::test(migrations = false)]
async fn deletion_only_sessions_cannot_read_or_mutate_onboarding(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user_with_status(
        &pool,
        "deletion-only-onboarding@example.test",
        "pending_deletion",
    )
    .await;
    let app = build_app(AppState { pool: pool.clone() });

    let read = app.clone().oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(read.status(), StatusCode::FORBIDDEN);

    let preferences = app
        .clone()
        .oneshot(put_preferences(
            &cookie,
            json!({
                "timezone": "Asia/Jakarta",
                "default_currency_code": "IDR",
            }),
        ))
        .await
        .unwrap();
    assert_eq!(preferences.status(), StatusCode::FORBIDDEN);

    let seed = app.oneshot(seed_categories(&cookie)).await.unwrap();
    assert_eq!(seed.status(), StatusCode::FORBIDDEN);

    let preferences: (String, Option<String>) =
        sqlx::query_as("SELECT timezone, default_currency_code FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(preferences, ("Etc/UTC".to_owned(), None));
    let categories: i64 = sqlx::query_scalar("SELECT count(*) FROM categories WHERE user_id = $1")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(categories, 0);
}

async fn authenticated_user(pool: &PgPool, email: &str) -> (Uuid, String) {
    authenticated_user_with_status(pool, email, "active").await
}

async fn authenticated_user_with_status(
    pool: &PgPool,
    email: &str,
    status: &str,
) -> (Uuid, String) {
    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, status) VALUES ($1, 'hash', $2::user_status) RETURNING id",
    )
    .bind(email)
    .bind(status)
    .fetch_one(pool)
    .await
    .unwrap();
    let token = format!("test-token-{user_id}");
    let token_hash = format!("{:x}", Sha256::digest(token.as_bytes()));
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + INTERVAL '1 day')",
    )
    .bind(user_id)
    .bind(token_hash)
    .execute(pool)
    .await
    .unwrap();
    (user_id, format!("__Host-cashmemo_session={token}"))
}

fn get_onboarding(cookie: &str) -> Request<Body> {
    Request::builder()
        .uri("/api/v1/onboarding")
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}

fn put_preferences(cookie: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri("/api/v1/settings/preferences")
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn seed_categories(cookie: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/v1/onboarding/seed-categories")
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
