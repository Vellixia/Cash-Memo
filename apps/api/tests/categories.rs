mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use chrono::Utc;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn creates_expense_and_income_categories_with_trimmed_unicode_names(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "category-create@example.test").await;
    let app = build_app(AppState { pool });
    let name = "🪨".repeat(80);

    let expense = app
        .clone()
        .oneshot(post_category(
            &cookie,
            json!({ "name": format!("  {name}  "), "kind": "expense" }),
        ))
        .await
        .unwrap();
    assert_eq!(expense.status(), StatusCode::CREATED);
    let expense = response_json(expense).await;
    assert_eq!(expense["name"], name);
    assert_eq!(expense["kind"], "expense");
    assert!(expense["archived_at"].is_null());

    let income = app
        .oneshot(post_category(
            &cookie,
            json!({ "name": name, "kind": "income" }),
        ))
        .await
        .unwrap();
    assert_eq!(income.status(), StatusCode::CREATED);
}

#[sqlx::test(migrations = false)]
async fn rejects_invalid_names_and_normalized_active_name_collisions(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "category-validation@example.test").await;
    let app = build_app(AppState { pool });

    for name in ["   ".to_owned(), "🪨".repeat(81)] {
        let response = app
            .clone()
            .oneshot(post_category(
                &cookie,
                json!({ "name": name, "kind": "expense" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    create_category(&app, &cookie, "Food", "expense").await;
    for name in ["  FOOD  ", "fOoD"] {
        let response = app
            .clone()
            .oneshot(post_category(
                &cookie,
                json!({ "name": name, "kind": "expense" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
}

#[sqlx::test(migrations = false)]
async fn renames_categories_and_rejects_active_name_collision(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "category-rename@example.test").await;
    let app = build_app(AppState { pool });
    let food = create_category(&app, &cookie, "Food", "expense").await;
    let travel = create_category(&app, &cookie, "Travel", "expense").await;
    let travel_id = travel["id"].as_str().unwrap();

    let renamed = app
        .clone()
        .oneshot(patch_category(
            &cookie,
            travel_id,
            json!({ "name": "  Trips  " }),
        ))
        .await
        .unwrap();
    assert_eq!(renamed.status(), StatusCode::OK);
    assert_eq!(response_json(renamed).await["name"], "Trips");

    let colliding = app
        .oneshot(patch_category(
            &cookie,
            travel_id,
            json!({ "name": food["name"] }),
        ))
        .await
        .unwrap();
    assert_eq!(colliding.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = false)]
async fn archive_preserves_history_and_restore_rejects_active_name_collision(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "category-archive@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let category = create_category(&app, &cookie, "Food", "expense").await;
    let category_id = category["id"].as_str().unwrap();
    let wallet_id = insert_wallet(&pool, user_id).await;
    insert_transaction(
        &pool,
        user_id,
        wallet_id,
        Uuid::parse_str(category_id).unwrap(),
    )
    .await;

    let archived = app
        .clone()
        .oneshot(post_archive(&cookie, category_id))
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    assert!(response_json(archived).await["archived_at"].is_string());
    let history_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM transactions WHERE category_id = $1")
            .bind(Uuid::parse_str(category_id).unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(history_count, 1);

    create_category(&app, &cookie, "food", "expense").await;
    let restored = app
        .oneshot(post_restore(&cookie, category_id))
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = false)]
async fn deletes_only_unreferenced_categories(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "category-delete@example.test").await;
    let app = build_app(AppState { pool: pool.clone() });
    let empty = create_category(&app, &cookie, "Empty", "expense").await;
    let empty_id = empty["id"].as_str().unwrap();

    let deleted = app
        .clone()
        .oneshot(delete_category(&cookie, empty_id))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let categories = app.clone().oneshot(get_categories(&cookie)).await.unwrap();
    assert_eq!(categories.status(), StatusCode::OK);
    assert!(
        response_json(categories)
            .await
            .as_array()
            .unwrap()
            .iter()
            .all(|category| category["id"] != empty_id)
    );

    let category = create_category(&app, &cookie, "Referenced", "expense").await;
    let category_id = Uuid::parse_str(category["id"].as_str().unwrap()).unwrap();
    let wallet_id = insert_wallet(&pool, user_id).await;
    insert_transaction(&pool, user_id, wallet_id, category_id).await;
    let response = app
        .clone()
        .oneshot(delete_category(&cookie, &category_id.to_string()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);

    sqlx::query("DELETE FROM transactions WHERE category_id = $1")
        .bind(category_id)
        .execute(&pool)
        .await
        .unwrap();
    insert_budget(&pool, user_id, category_id).await;
    let response = app
        .clone()
        .oneshot(delete_category(&cookie, &category_id.to_string()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);

    sqlx::query("DELETE FROM budgets WHERE category_id = $1")
        .bind(category_id)
        .execute(&pool)
        .await
        .unwrap();
    insert_recurring(&pool, user_id, wallet_id, category_id).await;
    let response = app
        .oneshot(delete_category(&cookie, &category_id.to_string()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[sqlx::test(migrations = false)]
async fn seeded_and_custom_categories_share_list_and_lifecycle_behavior(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "category-seeded@example.test").await;
    let app = build_app(AppState { pool });

    let seeded = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/onboarding/seed-categories",
            &cookie,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(seeded.status(), StatusCode::OK);
    let custom = create_category(&app, &cookie, "Custom", "expense").await;
    let categories = app.clone().oneshot(get_categories(&cookie)).await.unwrap();
    assert_eq!(categories.status(), StatusCode::OK);
    let categories = response_json(categories).await;
    assert!(
        categories
            .as_array()
            .unwrap()
            .iter()
            .any(|category| category["name"] == "Food & Drink")
    );
    assert!(
        categories
            .as_array()
            .unwrap()
            .iter()
            .any(|category| category["id"] == custom["id"])
    );

    let food_id = categories
        .as_array()
        .unwrap()
        .iter()
        .find(|category| category["name"] == "Food & Drink")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let archived = app.oneshot(post_archive(&cookie, food_id)).await.unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
}

#[sqlx::test(migrations = false)]
async fn hides_categories_from_other_users_for_all_routes(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_owner_id, owner_cookie) = authenticated_user(&pool, "category-owner@example.test").await;
    let (_other_id, other_cookie) = authenticated_user(&pool, "category-other@example.test").await;
    let app = build_app(AppState { pool });
    let category = create_category(&app, &owner_cookie, "Food", "expense").await;
    let category_id = category["id"].as_str().unwrap();

    let listed = app
        .clone()
        .oneshot(get_categories(&other_cookie))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    assert_eq!(response_json(listed).await, json!([]));
    for request in [
        patch_category(&other_cookie, category_id, json!({ "name": "Stolen" })),
        post_archive(&other_cookie, category_id),
        post_restore(&other_cookie, category_id),
        delete_category(&other_cookie, category_id),
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

async fn create_category(app: &axum::Router, cookie: &str, name: &str, kind: &str) -> Value {
    let response = app
        .clone()
        .oneshot(post_category(cookie, json!({ "name": name, "kind": kind })))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn insert_wallet(pool: &PgPool, user_id: Uuid) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Cash', 'USD', 0) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn insert_transaction(pool: &PgPool, user_id: Uuid, wallet_id: Uuid, category_id: Uuid) {
    sqlx::query(
        "INSERT INTO transactions (user_id, wallet_id, category_id, transaction_type, amount, occurred_at)
         VALUES ($1, $2, $3, 'EXPENSE', 5.00, $4)",
    )
    .bind(user_id)
    .bind(wallet_id)
    .bind(category_id)
    .bind(Utc::now())
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_budget(pool: &PgPool, user_id: Uuid, category_id: Uuid) {
    sqlx::query(
        "INSERT INTO budgets (user_id, category_id, currency_code, month_start, amount)
         VALUES ($1, $2, 'USD', DATE '2026-08-01', 10)",
    )
    .bind(user_id)
    .bind(category_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_recurring(pool: &PgPool, user_id: Uuid, wallet_id: Uuid, category_id: Uuid) {
    sqlx::query(
        "INSERT INTO recurring_transactions
         (user_id, wallet_id, category_id, transaction_type, amount, frequency, start_date, next_due_date)
         VALUES ($1, $2, $3, 'EXPENSE', 1.00, 'daily', CURRENT_DATE, CURRENT_DATE)",
    )
    .bind(user_id)
    .bind(wallet_id)
    .bind(category_id)
    .execute(pool)
    .await
    .unwrap();
}

fn post_category(cookie: &str, body: Value) -> Request<Body> {
    request("POST", "/api/v1/categories", cookie, Some(body))
}

fn get_categories(cookie: &str) -> Request<Body> {
    request("GET", "/api/v1/categories", cookie, None)
}

fn patch_category(cookie: &str, category_id: &str, body: Value) -> Request<Body> {
    request(
        "PATCH",
        &format!("/api/v1/categories/{category_id}"),
        cookie,
        Some(body),
    )
}

fn post_archive(cookie: &str, category_id: &str) -> Request<Body> {
    request(
        "POST",
        &format!("/api/v1/categories/{category_id}/archive"),
        cookie,
        None,
    )
}

fn post_restore(cookie: &str, category_id: &str) -> Request<Body> {
    request(
        "POST",
        &format!("/api/v1/categories/{category_id}/restore"),
        cookie,
        None,
    )
}

fn delete_category(cookie: &str, category_id: &str) -> Request<Body> {
    request(
        "DELETE",
        &format!("/api/v1/categories/{category_id}"),
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
