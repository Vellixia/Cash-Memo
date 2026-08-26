mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn history_uses_stable_keyset_traversal_and_explicit_load_more_contract(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "history@example.test").await;
    let wallet = insert_wallet(&pool, user_id).await;
    let category = insert_category(&pool, user_id).await;
    let occurred_at: DateTime<Utc> = "2026-08-21T12:00:00Z".parse().unwrap();
    let first = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        occurred_at,
        "first",
        false,
    )
    .await;
    let second = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        occurred_at,
        "second",
        false,
    )
    .await;
    let third = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        occurred_at,
        "third",
        false,
    )
    .await;
    let mut expected = vec![first, second, third];
    expected.sort_by(|left, right| right.cmp(left));
    assert_eq!(
        ordered_ids(&pool, user_id).await,
        expected,
        "fixture establishes the stable UUID tie-breaker"
    );

    let app = build_app(AppState { pool });
    let first_page = response_json(
        app.clone()
            .oneshot(request("/api/v1/transactions?limit=2", &cookie))
            .await
            .unwrap(),
    )
    .await;
    let first_ids = ids(&first_page);
    assert_eq!(first_ids, expected[..2]);
    let cursor = first_page["next_cursor"]
        .as_str()
        .expect("page must expose next_cursor");
    let second_page = response_json(
        app.clone()
            .oneshot(request(
                &format!("/api/v1/transactions?limit=2&cursor={cursor}"),
                &cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(ids(&second_page), expected[2..]);
    assert!(
        second_page["next_cursor"].is_null(),
        "last page makes Load-more exhaustion explicit"
    );
    assert_eq!(first_page["items"].as_array().unwrap().len(), 2);
}

#[sqlx::test(migrations = false)]
async fn history_rejects_invalid_bounds_and_untrusted_cursors(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (_user_id, cookie) = authenticated_user(&pool, "history-validation@example.test").await;
    let app = build_app(AppState { pool });

    for uri in [
        "/api/v1/transactions?limit=0",
        "/api/v1/transactions?limit=101",
        "/api/v1/transactions?cursor=not-base64url",
        "/api/v1/transactions?from=2026-04-01T00:00:00Z",
        "/api/v1/transactions?from=%202026-04-01%20",
        "/api/v1/transactions?from=2026-4-01",
        "/api/v1/transactions?to=2026-04-1",
        &format!("/api/v1/transactions?q={}", "x".repeat(101)),
    ] {
        let response = app.clone().oneshot(request(uri, &cookie)).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY, "{uri}");
        let body = response_json(response).await;
        assert_eq!(body["error"]["code"], "VALIDATION_FAILED");
    }
}

#[sqlx::test(migrations = false)]
async fn history_filters_literal_search_future_rows_and_trash_without_cross_user_replay(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let (owner_id, owner_cookie) = authenticated_user(&pool, "history-owner@example.test").await;
    let (other_id, other_cookie) = authenticated_user(&pool, "history-other@example.test").await;
    let owner_wallet = insert_wallet(&pool, owner_id).await;
    let owner_category = insert_category(&pool, owner_id).await;
    let other_wallet = insert_wallet(&pool, other_id).await;
    let other_category = insert_category(&pool, other_id).await;
    let active = insert_transaction(
        &pool,
        owner_id,
        owner_wallet,
        owner_category,
        "2030-01-02T00:00:00Z".parse().unwrap(),
        "Future 100%_\\ match",
        false,
    )
    .await;
    let _older_active = insert_transaction(
        &pool,
        owner_id,
        owner_wallet,
        owner_category,
        "2030-01-01T00:00:00Z".parse().unwrap(),
        "older",
        false,
    )
    .await;
    let trashed = insert_transaction(
        &pool,
        owner_id,
        owner_wallet,
        owner_category,
        "2030-01-01T00:00:00Z".parse().unwrap(),
        "trash",
        true,
    )
    .await;
    let other = insert_transaction(
        &pool,
        other_id,
        other_wallet,
        other_category,
        "2030-01-01T00:00:00Z".parse().unwrap(),
        "other",
        false,
    )
    .await;
    let app = build_app(AppState { pool });

    let active_page = response_json(app.clone().oneshot(request(&format!("/api/v1/transactions?wallet_id={owner_wallet}&category_id={owner_category}&type=expense&from=2030-01-01&to=2030-01-03&q=%20Future%20100%25_%5C%20%20"), &owner_cookie)).await.unwrap()).await;
    assert_eq!(ids(&active_page), vec![active]);
    let trash_page = response_json(
        app.clone()
            .oneshot(request("/api/v1/transactions/trash", &owner_cookie))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(ids(&trash_page), vec![trashed]);
    assert!(!ids(&active_page).contains(&trashed));

    let owner_cursor_page = response_json(
        app.clone()
            .oneshot(request("/api/v1/transactions?limit=1", &owner_cookie))
            .await
            .unwrap(),
    )
    .await;
    let owner_cursor = owner_cursor_page["next_cursor"]
        .as_str()
        .expect("owner page has continuation cursor");
    let other_page = response_json(
        app.clone()
            .oneshot(request(
                &format!("/api/v1/transactions?cursor={owner_cursor}"),
                &other_cookie,
            ))
            .await
            .unwrap(),
    )
    .await;
    let other_ids = ids(&other_page);
    assert!(!other_ids.contains(&active));
    assert!(!other_ids.contains(&trashed));
    assert!(other_ids.iter().all(|id| *id == other));
}

#[sqlx::test(migrations = false)]
async fn history_searches_owned_wallet_and_category_names_literally_in_active_and_trash(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "history-label-search@example.test").await;
    let wallet = insert_wallet(&pool, user_id).await;
    let category = insert_category(&pool, user_id).await;
    set_wallet_name(&pool, user_id, wallet, "Wallet %_\\ match").await;
    set_category_name(&pool, user_id, category, "Category %_\\ match").await;
    let active = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "2030-02-02T00:00:00Z".parse().unwrap(),
        "unrelated note",
        false,
    )
    .await;
    let trashed = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "2030-02-01T00:00:00Z".parse().unwrap(),
        "another unrelated note",
        true,
    )
    .await;
    let app = build_app(AppState { pool });

    for query in ["Wallet%20%25_%5C%20match", "Category%20%25_%5C%20match"] {
        let active_page = response_json(
            app.clone()
                .oneshot(request(&format!("/api/v1/transactions?q={query}"), &cookie))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(ids(&active_page), vec![active], "active query: {query}");

        let trash_page = response_json(
            app.clone()
                .oneshot(request(
                    &format!("/api/v1/transactions/trash?q={query}"),
                    &cookie,
                ))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(ids(&trash_page), vec![trashed], "trash query: {query}");
    }
}

#[sqlx::test(migrations = false)]
async fn history_uses_inclusive_user_local_dates_and_current_reference_names(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "history-local-date@example.test").await;
    sqlx::query("UPDATE users SET timezone = 'Asia/Jakarta' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let wallet = insert_wallet(&pool, user_id).await;
    let category = insert_category(&pool, user_id).await;
    set_wallet_name(&pool, user_id, wallet, "Travel Cash").await;
    set_category_name(&pool, user_id, category, "Dining").await;
    let before = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "2026-04-01T16:59:59Z".parse().unwrap(),
        "before Jakarta day",
        false,
    )
    .await;
    let included = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "2026-04-01T17:00:00Z".parse().unwrap(),
        "Jakarta day start",
        false,
    )
    .await;
    let after = insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "2026-04-02T17:00:00Z".parse().unwrap(),
        "next Jakarta day start",
        false,
    )
    .await;
    let app = build_app(AppState { pool });

    let response = app
        .oneshot(request(
            "/api/v1/transactions?from=2026-04-02&to=2026-04-02",
            &cookie,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let page = response_json(response).await;
    assert_eq!(ids(&page), vec![included]);
    assert!(!ids(&page).contains(&before));
    assert!(!ids(&page).contains(&after));
    assert_eq!(page["items"][0]["wallet_name"], "Travel Cash");
    assert_eq!(page["items"][0]["category_name"], "Dining");
}

#[sqlx::test(migrations = false)]
async fn history_returns_empty_for_fully_skipped_local_date(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "history-skipped-date@example.test").await;
    sqlx::query("UPDATE users SET timezone = 'Pacific/Apia' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let wallet = insert_wallet(&pool, user_id).await;
    let category = insert_category(&pool, user_id).await;
    insert_transaction(
        &pool,
        user_id,
        wallet,
        category,
        "2011-12-30T10:00:00Z".parse().unwrap(),
        "first instant after skipped date",
        false,
    )
    .await;
    let app = build_app(AppState { pool });

    let response = app
        .oneshot(request(
            "/api/v1/transactions?from=2011-12-30&to=2011-12-30",
            &cookie,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response_json(response).await["items"]
            .as_array()
            .unwrap()
            .is_empty()
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
    sqlx::query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + INTERVAL '1 day')")
        .bind(user_id)
        .bind(token_hash)
        .execute(pool)
        .await
        .unwrap();
    (user_id, format!("__Host-cashmemo_session={token}"))
}

async fn insert_wallet(pool: &PgPool, user_id: Uuid) -> Uuid {
    sqlx::query_scalar("INSERT INTO wallets (user_id, name, currency_code, opening_balance) VALUES ($1, $2, 'USD', 0) RETURNING id")
        .bind(user_id)
        .bind(format!("wallet-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn insert_category(pool: &PgPool, user_id: Uuid) -> Uuid {
    let name = format!("category-{}", Uuid::new_v4());
    sqlx::query_scalar("INSERT INTO categories (user_id, name, normalized_name, transaction_type) VALUES ($1, $2, $2, 'EXPENSE') RETURNING id")
        .bind(user_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn set_wallet_name(pool: &PgPool, user_id: Uuid, wallet_id: Uuid, name: &str) {
    sqlx::query("UPDATE wallets SET name = $3 WHERE user_id = $1 AND id = $2")
        .bind(user_id)
        .bind(wallet_id)
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
}

async fn set_category_name(pool: &PgPool, user_id: Uuid, category_id: Uuid, name: &str) {
    sqlx::query(
        "UPDATE categories SET name = $3, normalized_name = lower($3) WHERE user_id = $1 AND id = $2",
    )
    .bind(user_id)
    .bind(category_id)
    .bind(name)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_transaction(
    pool: &PgPool,
    user_id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    occurred_at: DateTime<Utc>,
    note: &str,
    trashed: bool,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO transactions (user_id, wallet_id, category_id, transaction_type, amount, occurred_at, note, deleted_at, purge_after)
         VALUES ($1, $2, $3, 'EXPENSE', 1, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END, CASE WHEN $6 THEN now() + INTERVAL '30 days' ELSE NULL END) RETURNING id",
    )
    .bind(user_id).bind(wallet_id).bind(category_id).bind(occurred_at).bind(note).bind(trashed)
    .fetch_one(pool).await.unwrap()
}

async fn ordered_ids(pool: &PgPool, user_id: Uuid) -> Vec<Uuid> {
    sqlx::query_scalar(
        "SELECT id FROM transactions WHERE user_id = $1 ORDER BY occurred_at DESC, id DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn request(uri: &str, cookie: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap()
}

fn ids(page: &Value) -> Vec<Uuid> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| Uuid::parse_str(item["id"].as_str().unwrap()).unwrap())
        .collect()
}

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
