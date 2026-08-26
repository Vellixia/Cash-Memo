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
            "categories_seeded": true,
            "has_active_wallet": true,
        })
    );
    let starter_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM categories WHERE user_id = $1 AND starter_key IS NOT NULL",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(starter_count, EXPECTED_STARTER_COUNT);
    let completed_at: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(completed_at.is_some());
}

#[sqlx::test(migrations = false)]
async fn completed_user_reconciles_missing_starter_categories_once(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "onboarding-reconcile@example.test").await;
    sqlx::query(
        "UPDATE users
         SET timezone = 'Asia/Jakarta', timezone_configured_at = now(),
             default_currency_code = 'IDR', onboarding_completed_at = '2026-01-02T03:04:05Z'
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type, starter_key)
         VALUES
             ($1, 'Food & Drink', 'food & drink', 'EXPENSE', 'starter_expense_food_drink'),
             ($1, 'Salary', 'salary', 'INCOME', 'starter_income_salary')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance, archived_at)
         VALUES ($1, 'Archived Cash', 'IDR', 0, now())",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let app = build_app(AppState { pool: pool.clone() });

    for _ in 0..2 {
        let response = app.clone().oneshot(get_onboarding(&cookie)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response_json(response).await,
            json!({
                "timezone_configured": true,
                "timezone": "Asia/Jakarta",
                "default_currency_configured": true,
                "default_currency_code": "IDR",
                "categories_seeded": true,
                "has_active_wallet": true,
            })
        );
    }

    let starters: Vec<(String, String)> = sqlx::query_as(
        "SELECT starter_key, normalized_name
         FROM categories WHERE user_id = $1 AND starter_key IS NOT NULL
         ORDER BY starter_key",
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(starters.len() as i64, EXPECTED_STARTER_COUNT);
    assert_eq!(
        starters
            .iter()
            .filter(|(key, normalized)| {
                key == "starter_expense_food_drink" && normalized == "food & drink"
            })
            .count(),
        1
    );
    assert_eq!(
        starters
            .iter()
            .filter(|(key, normalized)| {
                key == "starter_income_salary" && normalized == "salary"
            })
            .count(),
        1
    );
    let completed_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(completed_at.to_rfc3339(), "2026-01-02T03:04:05+00:00");
}

#[sqlx::test(migrations = false)]
async fn wallet_creation_reconciles_active_custom_starter_name_collision(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) =
        authenticated_user(&pool, "onboarding-name-collision@example.test").await;
    sqlx::query(
        "UPDATE users
         SET timezone = 'Asia/Jakarta', timezone_configured_at = now(), default_currency_code = 'IDR'
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let custom_id: Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Food & Drink', 'food & drink', 'EXPENSE') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let app = build_app(AppState { pool: pool.clone() });

    let created = app
        .clone()
        .oneshot(post_wallet(
            &cookie,
            json!({ "name": "Cash", "currency": "IDR", "opening_balance": "0" }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);

    let custom: (Option<String>, String, String) = sqlx::query_as(
        "SELECT starter_key, normalized_name, transaction_type::TEXT
         FROM categories WHERE id = $1",
    )
    .bind(custom_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        custom,
        (None, "food & drink".to_owned(), "EXPENSE".to_owned())
    );

    let state = app.oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(state.status(), StatusCode::OK);
    assert_eq!(response_json(state).await["categories_seeded"], true);
    let active_collision_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM categories
         WHERE user_id = $1 AND transaction_type = 'EXPENSE'
           AND normalized_name = 'food & drink' AND archived_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active_collision_count, 1);
}

#[sqlx::test(migrations = false)]
async fn concurrent_category_reconciliation_handles_active_custom_name_collision(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) =
        authenticated_user(&pool, "onboarding-concurrent-collision@example.test").await;
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
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Food & Drink', 'food & drink', 'EXPENSE')",
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
    let repeated = app.oneshot(seed_categories(&cookie)).await.unwrap();
    assert_eq!(repeated.status(), StatusCode::OK);

    let state = response_json(
        build_app(AppState { pool: pool.clone() })
            .oneshot(get_onboarding(&cookie))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(state["categories_seeded"], true);
    let active_collision_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM categories
         WHERE user_id = $1 AND transaction_type = 'EXPENSE'
           AND normalized_name = 'food & drink' AND archived_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(active_collision_count, 1);
}

#[sqlx::test(migrations = false)]
async fn renamed_starter_category_remains_seeded_and_completed(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) =
        authenticated_user(&pool, "onboarding-renamed-starter@example.test").await;
    sqlx::query(
        "UPDATE users
         SET timezone = 'Asia/Jakarta', timezone_configured_at = now(), default_currency_code = 'IDR'
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let app = build_app(AppState { pool: pool.clone() });
    let created = app
        .clone()
        .oneshot(post_wallet(
            &cookie,
            json!({ "name": "Cash", "currency": "IDR", "opening_balance": "0" }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let before: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query(
        "UPDATE categories
         SET name = 'Meals', normalized_name = 'meals'
         WHERE user_id = $1 AND starter_key = 'starter_expense_food_drink'",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let state = app.oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(state.status(), StatusCode::OK);
    assert_eq!(response_json(state).await["categories_seeded"], true);
    let after: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after, before);
    let starter: (String, String, String) = sqlx::query_as(
        "SELECT name, normalized_name, transaction_type::TEXT
         FROM categories WHERE user_id = $1 AND starter_key = 'starter_expense_food_drink'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        starter,
        ("Meals".to_owned(), "meals".to_owned(), "EXPENSE".to_owned())
    );
    let canonical_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM categories
         WHERE user_id = $1 AND transaction_type = 'EXPENSE'
           AND normalized_name = 'food & drink'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(canonical_count, 0);
}

#[sqlx::test(migrations = false)]
async fn incorrectly_typed_starter_key_does_not_satisfy_seeded_slot(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) =
        authenticated_user(&pool, "onboarding-wrong-type-starter@example.test").await;
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
         VALUES ($1, 'Income Food', 'income food', 'INCOME', 'starter_expense_food_drink')",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let app = build_app(AppState { pool: pool.clone() });
    let created = app
        .clone()
        .oneshot(post_wallet(
            &cookie,
            json!({ "name": "Cash", "currency": "IDR", "opening_balance": "0" }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let state = app.oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(state.status(), StatusCode::OK);
    assert_eq!(response_json(state).await["categories_seeded"], false);
}

#[sqlx::test(migrations = false)]
async fn first_wallet_sets_onboarding_completion_once(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "onboarding-first-wallet@example.test").await;
    sqlx::query(
        "UPDATE users
         SET timezone = 'Asia/Jakarta', timezone_configured_at = now(), default_currency_code = 'IDR'
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let app = build_app(AppState { pool: pool.clone() });
    let seeded = app.clone().oneshot(seed_categories(&cookie)).await.unwrap();
    assert_eq!(seeded.status(), StatusCode::OK);
    let created = app
        .clone()
        .oneshot(post_wallet(
            &cookie,
            json!({ "name": "Cash", "currency": "IDR", "opening_balance": "0" }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let first_completed_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let state = app.oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(state.status(), StatusCode::OK);
    let second_completed_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(second_completed_at, first_completed_at);
}

#[sqlx::test(migrations = false)]
async fn completed_onboarding_survives_archive_and_delete_of_only_wallet(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) =
        authenticated_user(&pool, "onboarding-wallet-lifecycle@example.test").await;
    sqlx::query(
        "UPDATE users
         SET timezone = 'Asia/Jakarta', timezone_configured_at = now(), default_currency_code = 'IDR'
         WHERE id = $1",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
    let app = build_app(AppState { pool: pool.clone() });
    let created = app
        .clone()
        .oneshot(post_wallet(
            &cookie,
            json!({ "name": "Cash", "currency": "IDR", "opening_balance": "0" }),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    let wallet_id = response_json(created).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let first_completed_at: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let archived = app
        .clone()
        .oneshot(post_archive(&cookie, &wallet_id))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    let archived_state = app.clone().oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(archived_state.status(), StatusCode::OK);
    assert_eq!(
        response_json(archived_state).await["has_active_wallet"],
        true
    );
    let after_archive: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after_archive, first_completed_at);

    let deleted = app
        .clone()
        .oneshot(delete_wallet(&cookie, &wallet_id))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let deleted_state = app.oneshot(get_onboarding(&cookie)).await.unwrap();
    assert_eq!(deleted_state.status(), StatusCode::OK);
    assert_eq!(
        response_json(deleted_state).await["has_active_wallet"],
        true
    );
    let after_delete: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT onboarding_completed_at FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after_delete, first_completed_at);
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

fn post_wallet(cookie: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/v1/wallets")
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn post_archive(cookie: &str, wallet_id: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/api/v1/wallets/{wallet_id}/archive"))
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap()
}

fn delete_wallet(cookie: &str, wallet_id: &str) -> Request<Body> {
    Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/wallets/{wallet_id}"))
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
