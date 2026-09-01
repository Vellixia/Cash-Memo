use std::{sync::Arc, time::Duration};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header::SET_COOKIE},
};
use cashmemo_api::accounts::routes::CancelAuthorizationHook;
use cashmemo_api::{
    accounts::{
        AccountDeletionError, AccountDeletionService, AccountStatus, PasswordVerificationHook,
    },
    auth::{AuthConfig, AuthError, AuthService, SessionAccess, UnconfiguredEmailSender},
    receipts::{DeletionReceipt, DeletionReceiptStore, ReceiptError, ReceiptWrite},
};
use sqlx::PgPool;
use tower::ServiceExt;

#[derive(Default)]
struct FakeReceipts {
    fail: bool,
    writes: std::sync::Mutex<Vec<DeletionReceipt>>,
}

struct DelayedReceipts {
    delay: Duration,
    writes: std::sync::Mutex<usize>,
}

#[async_trait::async_trait]
impl DeletionReceiptStore for DelayedReceipts {
    async fn put_receipt(&self, _: &DeletionReceipt) -> Result<ReceiptWrite, ReceiptError> {
        tokio::time::sleep(self.delay).await;
        *self.writes.lock().unwrap() += 1;
        Ok(ReceiptWrite::Created)
    }
}

#[async_trait::async_trait]
impl DeletionReceiptStore for FakeReceipts {
    async fn put_receipt(&self, receipt: &DeletionReceipt) -> Result<ReceiptWrite, ReceiptError> {
        if self.fail {
            return Err(ReceiptError::Storage);
        }
        self.writes.lock().unwrap().push(receipt.clone());
        Ok(ReceiptWrite::Created)
    }
}

fn auth(pool: PgPool) -> AuthService {
    AuthService::new(
        pool,
        Arc::new(UnconfiguredEmailSender),
        AuthConfig::for_tests(),
    )
}

async fn active_account(pool: &PgPool) -> (AuthService, uuid::Uuid) {
    let auth = auth(pool.clone());
    auth.register("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let user_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "UPDATE users SET email_verified = TRUE, status = 'active' WHERE email = 'delete-me@example.com' RETURNING id",
    ).fetch_one(pool).await.unwrap();
    (auth, user_id)
}

async fn seed_generated_occurrence_history(pool: &PgPool, user_id: uuid::Uuid) {
    let wallet_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code)
         VALUES ($1, 'Purge wallet', 'USD') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let category_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO categories
         (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Purge category', 'purge category', 'EXPENSE') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let recurring_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO recurring_transactions
         (user_id, wallet_id, category_id, transaction_type, amount, frequency,
          start_date, next_due_date)
         VALUES ($1, $2, $3, 'EXPENSE', 1, 'daily', DATE '2026-08-30', DATE '2026-08-31')
         RETURNING id",
    )
    .bind(user_id)
    .bind(wallet_id)
    .bind(category_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let occurrence_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO recurring_occurrences
         (user_id, recurring_transaction_id, scheduled_for)
         VALUES ($1, $2, DATE '2026-08-30') RETURNING id",
    )
    .bind(user_id)
    .bind(recurring_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO transactions
         (user_id, wallet_id, category_id, transaction_type, amount, occurred_at,
          recurring_occurrence_id)
         VALUES ($1, $2, $3, 'EXPENSE', 1, TIMESTAMPTZ '2026-08-30T00:00:00Z', $4)",
    )
    .bind(user_id)
    .bind(wallet_id)
    .bind(category_id)
    .bind(occurrence_id)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn recent_password_starts_seven_day_deletion_and_revokes_all_sessions(pool: PgPool) {
    let (auth, user_id) = active_account(&pool).await;
    let first = auth
        .login("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let second = auth
        .login("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let deletion = AccountDeletionService::new(pool.clone());

    assert_eq!(
        deletion.request(user_id, "wrong password").await,
        Err(AccountDeletionError::RecentPasswordRequired)
    );
    let status = deletion
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();

    assert_eq!(status.status, AccountStatus::PendingDeletion);
    let due = status.deletion_due_at.unwrap();
    assert!(due > chrono::Utc::now() + chrono::Duration::days(6));
    assert!(due <= chrono::Utc::now() + chrono::Duration::days(8));
    assert!(auth.session(&first.raw_token).await.is_err());
    assert!(auth.session(&second.raw_token).await.is_err());
    assert_eq!(
        auth.login("delete-me@example.com", "correct horse battery staple")
            .await
            .unwrap()
            .access,
        SessionAccess::DeletionOnly
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn cancellation_requires_password_then_revokes_restricted_session_and_clears_cookie(
    pool: PgPool,
) {
    let (auth, user_id) = active_account(&pool).await;
    let deletion = AccountDeletionService::new(pool.clone());
    deletion
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    let restricted = auth
        .login("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    assert_eq!(restricted.access, SessionAccess::DeletionOnly);
    let app = Router::new()
        .merge(cashmemo_api::accounts::routes::router(deletion))
        .layer(axum::extract::Extension(auth.clone()));

    let cancel_wrong = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/account/deletion/cancel")
                .extension(cashmemo_api::http::RequestId::new())
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("__Host-cashmemo_session={}", restricted.raw_token),
                )
                .body(Body::from(r#"{"password":"wrong password"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cancel_wrong.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        auth.session(&restricted.raw_token).await.unwrap().access,
        SessionAccess::DeletionOnly
    );

    let cancel_ok = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/account/deletion/cancel")
                .extension(cashmemo_api::http::RequestId::new())
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("__Host-cashmemo_session={}", restricted.raw_token),
                )
                .body(Body::from(r#"{"password":"correct horse battery staple"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cancel_ok.status(), StatusCode::OK);
    assert!(
        cancel_ok.headers()[SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    assert_eq!(
        auth.session(&restricted.raw_token).await,
        Err(AuthError::Unauthorized)
    );
    assert_eq!(
        auth.login("delete-me@example.com", "correct horse battery staple")
            .await
            .unwrap()
            .access,
        SessionAccess::Full
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn full_session_cannot_cancel_account_deletion(pool: PgPool) {
    let (auth, user_id) = active_account(&pool).await;
    let full = auth
        .login("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    assert_eq!(full.access, SessionAccess::Full);
    let app = Router::new()
        .merge(cashmemo_api::accounts::routes::router(
            AccountDeletionService::new(pool.clone()),
        ))
        .layer(axum::extract::Extension(auth));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/account/deletion/cancel")
                .extension(cashmemo_api::http::RequestId::new())
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("__Host-cashmemo_session={}", full.raw_token),
                )
                .body(Body::from(r#"{"password":"correct horse battery staple"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status::TEXT FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "active"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn full_session_captured_before_deletion_cannot_cancel_after_deletion_starts(pool: PgPool) {
    let (auth, user_id) = active_account(&pool).await;
    let full = auth
        .login("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let hook = Arc::new(CancelAuthorizationHook::new());
    let app = Router::new()
        .merge(cashmemo_api::accounts::routes::router(
            AccountDeletionService::new(pool.clone()),
        ))
        .layer(axum::extract::Extension(auth.clone()))
        .layer(axum::extract::Extension(hook.clone()));
    let cancellation = tokio::spawn(async move {
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/account/deletion/cancel")
                .extension(cashmemo_api::http::RequestId::new())
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("__Host-cashmemo_session={}", full.raw_token),
                )
                .body(Body::from(r#"{"password":"correct horse battery staple"}"#))
                .unwrap(),
        )
        .await
        .unwrap()
    });

    hook.wait_until_session_is_captured().await;
    AccountDeletionService::new(pool.clone())
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    hook.resume();
    let response = cancellation.await.unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        AccountDeletionService::new(pool.clone())
            .status(user_id)
            .await
            .unwrap()
            .status,
        AccountStatus::PendingDeletion
    );
    assert_eq!(
        auth.login("delete-me@example.com", "correct horse battery staple")
            .await
            .unwrap()
            .access,
        SessionAccess::DeletionOnly
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn request_rejects_status_changed_after_password_verification_without_full_session(
    pool: PgPool,
) {
    let (auth, user_id) = active_account(&pool).await;
    let full = auth
        .login("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let hook = Arc::new(PasswordVerificationHook::new());
    let deletion =
        AccountDeletionService::new(pool.clone()).with_password_verification_hook(hook.clone());
    let request = tokio::spawn({
        let deletion = deletion.clone();
        async move {
            deletion
                .request(user_id, "correct horse battery staple")
                .await
        }
    });

    hook.wait_until_verified().await;
    let status_update = tokio::time::timeout(
        Duration::from_millis(200),
        sqlx::query("UPDATE users SET status = 'pending_deletion' WHERE id = $1")
            .bind(user_id)
            .execute(&pool),
    )
    .await;
    hook.resume();
    let result = request.await.unwrap();

    assert!(
        matches!(status_update, Ok(Ok(_))),
        "status update must complete before deletion transition locks user"
    );
    assert_eq!(result, Err(AccountDeletionError::RecentPasswordRequired));
    assert_eq!(
        deletion.status(user_id).await.unwrap().status,
        AccountStatus::PendingDeletion
    );
    assert_eq!(
        auth.session(&full.raw_token).await.unwrap().access,
        SessionAccess::DeletionOnly
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn cancellation_rejects_hash_changed_after_password_verification_without_full_session(
    pool: PgPool,
) {
    let (auth, user_id) = active_account(&pool).await;
    let initial = AccountDeletionService::new(pool.clone());
    initial
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    let restricted = auth
        .login("delete-me@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let hook = Arc::new(PasswordVerificationHook::new());
    let deletion =
        AccountDeletionService::new(pool.clone()).with_password_verification_hook(hook.clone());
    let cancel = tokio::spawn({
        let deletion = deletion.clone();
        async move {
            deletion
                .cancel(user_id, "correct horse battery staple")
                .await
        }
    });

    hook.wait_until_verified().await;
    let hash_update = tokio::time::timeout(
        Duration::from_millis(200),
        sqlx::query("UPDATE users SET password_hash = 'changed-during-confirmation' WHERE id = $1")
            .bind(user_id)
            .execute(&pool),
    )
    .await;
    hook.resume();
    let result = cancel.await.unwrap();

    assert!(
        matches!(hash_update, Ok(Ok(_))),
        "password hash update must complete before cancellation transition locks user"
    );
    assert_eq!(result, Err(AccountDeletionError::RecentPasswordRequired));
    assert_eq!(
        deletion.status(user_id).await.unwrap().status,
        AccountStatus::PendingDeletion
    );
    assert_eq!(
        auth.session(&restricted.raw_token).await.unwrap().access,
        SessionAccess::DeletionOnly
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn claim_is_atomic_and_cancellation_fails_after_purging(pool: PgPool) {
    let (_auth, user_id) = active_account(&pool).await;
    let deletion = AccountDeletionService::new(pool.clone());
    deletion
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    sqlx::query("UPDATE users SET deletion_due_at = now() - INTERVAL '1 second' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (first, second) = tokio::join!(
        deletion.claim_next("worker-one", Duration::from_secs(30)),
        deletion.claim_next("worker-two", Duration::from_secs(30)),
    );
    assert_eq!(
        usize::from(first.unwrap().is_some()) + usize::from(second.unwrap().is_some()),
        1
    );
    assert_eq!(
        deletion
            .cancel(user_id, "correct horse battery staple")
            .await,
        Err(AccountDeletionError::NotPending)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn concurrent_login_and_deletion_leave_no_live_full_session(pool: PgPool) {
    let (auth, user_id) = active_account(&pool).await;
    let deletion = AccountDeletionService::new(pool.clone());
    let login = auth.login("delete-me@example.com", "correct horse battery staple");
    let request = deletion.request(user_id, "correct horse battery staple");
    let (login, request) = tokio::join!(login, request);
    request.unwrap();
    if let Ok(login) = login
        && let Ok(session) = auth.session(&login.raw_token).await
    {
        assert_ne!(session.access, SessionAccess::Full);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn expired_or_slow_claimant_cannot_delete_after_takeover_or_lease_expiry(pool: PgPool) {
    let (_auth, user_id) = active_account(&pool).await;
    let deletion = AccountDeletionService::new(pool.clone());
    deletion
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    sqlx::query("UPDATE users SET deletion_due_at = now() - INTERVAL '1 second' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let stale = deletion
        .claim_next("stale", Duration::from_secs(1))
        .await
        .unwrap()
        .unwrap();
    sqlx::query("UPDATE users SET purge_claimed_until = now() - INTERVAL '1 second' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let replacement = deletion
        .claim_next("replacement", Duration::from_secs(1))
        .await
        .unwrap()
        .unwrap();
    let receipts = FakeReceipts::default();
    assert_eq!(
        deletion.purge_claim(&stale, &[3; 32], 1, &receipts).await,
        Err(AccountDeletionError::ClaimLost)
    );
    assert!(receipts.writes.lock().unwrap().is_empty());

    let slow = DelayedReceipts {
        delay: Duration::from_millis(75),
        writes: std::sync::Mutex::new(0),
    };
    let short_claim = cashmemo_api::accounts::DeletionClaim {
        lease: Duration::from_millis(25),
        ..replacement
    };
    assert_eq!(
        deletion.purge_claim(&short_claim, &[3; 32], 1, &slow).await,
        Err(AccountDeletionError::ClaimLost)
    );
    assert_eq!(*slow.writes.lock().unwrap(), 1);
    assert!(
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&pool)
            .await
            .unwrap()
            .is_some()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn live_account_purge_keeps_receipt_and_cascades_generated_occurrence_history(pool: PgPool) {
    let (_auth, user_id) = active_account(&pool).await;
    seed_generated_occurrence_history(&pool, user_id).await;
    let deletion = AccountDeletionService::new(pool.clone());
    deletion
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    sqlx::query("UPDATE users SET deletion_due_at = now() - INTERVAL '1 second' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let claim = deletion
        .claim_next("occurrence-cascade", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    let receipts = FakeReceipts::default();

    deletion
        .purge_claim(&claim, &[4; 32], 3, &receipts)
        .await
        .unwrap();

    let written_key_version = {
        let written = receipts.writes.lock().unwrap();
        assert_eq!(written.len(), 1, "durable receipt precedes live purge");
        written[0].key_version
    };
    assert_eq!(written_key_version, 3);
    for table in [
        "users",
        "wallets",
        "categories",
        "recurring_transactions",
        "recurring_occurrences",
        "transactions",
    ] {
        let remaining: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE {} = $1",
            if table == "users" { "id" } else { "user_id" }
        ))
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(remaining, 0, "{table} must be removed by account cascade");
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn receipt_failure_and_db_delete_failure_keep_live_purging_data_retryable(pool: PgPool) {
    let (_auth, user_id) = active_account(&pool).await;
    let deletion = AccountDeletionService::new(pool.clone());
    deletion
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    sqlx::query("UPDATE users SET deletion_due_at = now() - INTERVAL '1 second' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let claim = deletion
        .claim_next("worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();

    let failing = FakeReceipts {
        fail: true,
        ..Default::default()
    };
    assert_eq!(
        deletion.purge_claim(&claim, &[7; 32], 1, &failing).await,
        Err(AccountDeletionError::Receipt)
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status::TEXT FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "purging"
    );

    sqlx::query("CREATE FUNCTION fail_account_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated db failure'; END; $$").execute(&pool).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_account_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION fail_account_delete()").execute(&pool).await.unwrap();
    let receipts = FakeReceipts::default();
    assert_eq!(
        deletion.purge_claim(&claim, &[7; 32], 1, &receipts).await,
        Err(AccountDeletionError::Persistence)
    );
    assert_eq!(receipts.writes.lock().unwrap().len(), 1);
    assert!(
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&pool)
            .await
            .unwrap()
            .is_some()
    );
    sqlx::query("DROP TRIGGER fail_account_delete ON users")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION fail_account_delete()")
        .execute(&pool)
        .await
        .unwrap();
    deletion
        .purge_claim(&claim, &[7; 32], 1, &receipts)
        .await
        .unwrap();
    assert!(
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&pool)
            .await
            .unwrap()
            .is_none()
    );
}

#[cfg(feature = "s3-receipts")]
#[sqlx::test(migrations = "./migrations")]
async fn db_delete_retry_reuses_concrete_s3_receipt_before_live_cascade(pool: PgPool) {
    use cashmemo_api::receipts::{
        canonical_receipt_bytes, hmac_user_id,
        s3::{S3DeletionReceiptStore, S3ReceiptConfig},
    };
    use std::env;

    let (_auth, user_id) = active_account(&pool).await;
    let deletion = AccountDeletionService::new(pool.clone());
    deletion
        .request(user_id, "correct horse battery staple")
        .await
        .unwrap();
    sqlx::query("UPDATE users SET deletion_due_at = now() - INTERVAL '1 second' WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let claim = deletion
        .claim_next("concrete-s3-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    let config = S3ReceiptConfig {
        endpoint: env::var("TEST_DELETION_RECEIPT_S3_ENDPOINT").unwrap(),
        region: "us-east-1".into(),
        bucket: env::var("TEST_DELETION_RECEIPT_S3_BUCKET").unwrap(),
        prefix: "db-retry".into(),
        access_key_id: env::var("TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID").unwrap(),
        secret_access_key: env::var("TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY").unwrap(),
        allow_insecure_local_endpoint: true,
    };
    let store = S3DeletionReceiptStore::connect(config.clone())
        .await
        .unwrap();
    sqlx::query("CREATE FUNCTION fail_account_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated db failure'; END; $$").execute(&pool).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_account_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION fail_account_delete()").execute(&pool).await.unwrap();
    assert_eq!(
        deletion.purge_claim(&claim, &[8; 32], 2, &store).await,
        Err(AccountDeletionError::Persistence)
    );
    let receipt = DeletionReceipt::new(
        hmac_user_id(&[8; 32], user_id).unwrap(),
        claim.purge_started_at,
        2,
    );
    let expected = canonical_receipt_bytes(&receipt).unwrap();
    assert_eq!(
        store.put_receipt(&receipt).await.unwrap(),
        ReceiptWrite::AlreadyPresentIdentical
    );
    sqlx::query("DROP TRIGGER fail_account_delete ON users")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION fail_account_delete()")
        .execute(&pool)
        .await
        .unwrap();
    deletion
        .purge_claim(&claim, &[8; 32], 2, &store)
        .await
        .unwrap();
    assert!(
        sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&pool)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(expected, canonical_receipt_bytes(&receipt).unwrap());
}
