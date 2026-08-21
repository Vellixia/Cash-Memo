use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use cashmemo_api::auth::{
    AuthConfig, AuthError, AuthService, EmailError, EmailSender, PasswordError, SessionAccess,
    normalize_email, validate_password,
};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[derive(Default)]
struct FakeEmailSender {
    verification: Mutex<Vec<(String, String)>>,
    resets: Mutex<Vec<(String, String)>>,
}

#[async_trait::async_trait]
impl EmailSender for FakeEmailSender {
    async fn send_verification(&self, to: &str, raw_token: &str) -> Result<(), EmailError> {
        self.verification
            .lock()
            .unwrap()
            .push((to.to_owned(), raw_token.to_owned()));
        Ok(())
    }

    async fn send_password_reset(&self, to: &str, raw_token: &str) -> Result<(), EmailError> {
        self.resets
            .lock()
            .unwrap()
            .push((to.to_owned(), raw_token.to_owned()));
        Ok(())
    }
}

fn service(pool: PgPool, mailer: Arc<FakeEmailSender>) -> AuthService {
    AuthService::new(pool, mailer, AuthConfig::for_tests())
}

#[test]
fn email_normalization_is_trim_and_lowercase_only() {
    assert_eq!(
        normalize_email("  Alice+Cash.Memo@Example.COM "),
        "alice+cash.memo@example.com"
    );
}

#[test]
fn password_boundaries_count_unicode_code_points_and_bytes() {
    assert!(validate_password(&"a".repeat(15)).is_ok());
    assert!(validate_password(&"a".repeat(128)).is_ok());
    assert_eq!(
        validate_password(&"a".repeat(14)),
        Err(PasswordError::TooShort)
    );
    assert_eq!(
        validate_password(&"a".repeat(129)),
        Err(PasswordError::TooLong)
    );
    assert_eq!(
        validate_password(&"😀".repeat(129)),
        Err(PasswordError::TooLong)
    );
    assert!(validate_password(&"😀".repeat(128)).is_ok());
}

#[sqlx::test(migrations = "./migrations")]
async fn registration_hashes_password_and_stores_only_hashed_256_bit_token(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool.clone(), mailer.clone());

    auth.register("  ALICE+tag@Example.com ", "correct horse battery staple")
        .await
        .unwrap();

    let (email, password_hash): (String, String) =
        sqlx::query_as("SELECT email, password_hash FROM users")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(email, "alice+tag@example.com");
    assert!(password_hash.starts_with("$argon2id$"));

    let raw = mailer.verification.lock().unwrap()[0].1.clone();
    assert_eq!(raw.len(), 43);
    let stored: String = sqlx::query_scalar("SELECT token_hash FROM auth_tokens")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(stored, raw);
    assert_eq!(stored.len(), 64);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM auth_tokens WHERE token_hash = $1")
            .bind(&raw)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn verification_tokens_are_replaced_single_use_and_expiring(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool.clone(), mailer.clone());
    auth.register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let first = mailer.verification.lock().unwrap()[0].1.clone();
    auth.resend_verification("alice@example.com").await.unwrap();
    let second = mailer.verification.lock().unwrap()[1].1.clone();
    assert_ne!(first, second);
    assert_eq!(
        auth.verify_email(&first).await,
        Err(AuthError::InvalidToken)
    );
    auth.verify_email(&second).await.unwrap();
    assert_eq!(
        auth.verify_email(&second).await,
        Err(AuthError::InvalidToken)
    );
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT email_verified FROM users")
            .fetch_one(&pool)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn login_is_enumeration_safe_and_only_reveals_unverified_after_password_check(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool, mailer.clone());
    auth.register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();

    assert_eq!(
        auth.login("missing@example.com", "correct horse battery staple")
            .await,
        auth.login("alice@example.com", "wrong password that is long enough")
            .await,
    );
    assert_eq!(
        auth.login("alice@example.com", "correct horse battery staple")
            .await,
        Err(AuthError::EmailNotVerified),
    );
    let token = mailer.verification.lock().unwrap()[0].1.clone();
    auth.verify_email(&token).await.unwrap();
    assert!(
        auth.login("alice@example.com", "correct horse battery staple")
            .await
            .is_ok()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn sessions_honor_idle_and_absolute_expiry_and_revoke_operations(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool.clone(), mailer.clone());
    auth.register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let verification = mailer.verification.lock().unwrap()[0].1.clone();
    auth.verify_email(&verification).await.unwrap();
    let first = auth
        .login("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let second = auth
        .login("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    assert_eq!(
        auth.session(&first.raw_token).await.unwrap().access,
        SessionAccess::Full
    );
    auth.logout(&first.raw_token).await.unwrap();
    assert_eq!(
        auth.session(&first.raw_token).await,
        Err(AuthError::Unauthorized)
    );
    auth.revoke_all(second.user_id).await.unwrap();
    assert_eq!(
        auth.session(&second.raw_token).await,
        Err(AuthError::Unauthorized)
    );

    let expired_id = Uuid::new_v4();
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) SELECT $1, id, repeat('a', 64), now() - interval '31 days', now(), now() + interval '1 day' FROM users")
        .bind(expired_id).execute(&pool).await.unwrap();
    assert_eq!(
        auth.session_for_hash(&"a".repeat(64)).await,
        Err(AuthError::Unauthorized)
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn session_touch_is_hourly_and_login_sets_host_only_secure_cookie(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool.clone(), mailer.clone());
    auth.register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let verification = mailer.verification.lock().unwrap()[0].1.clone();
    auth.verify_email(&verification).await.unwrap();
    let login = auth
        .login("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    sqlx::query("UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE id = $1")
        .bind(login.session_id)
        .execute(&pool)
        .await
        .unwrap();
    auth.session(&login.raw_token).await.unwrap();
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT last_seen_at > now() - interval '1 minute' FROM sessions WHERE id = $1"
        )
        .bind(login.session_id)
        .fetch_one(&pool)
        .await
        .unwrap()
    );

    let app = cashmemo_api::auth::routes::router(auth);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/login")
                .extension(cashmemo_api::http::RequestId::new())
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"email":"alice@example.com","password":"correct horse battery staple"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"].to_str().unwrap();
    assert!(cookie.starts_with("__Host-cashmemo_session="));
    assert!(cookie.contains("Path=/; Secure; HttpOnly; SameSite=Lax"));
    assert!(!cookie.contains("Domain="));
}

#[sqlx::test(migrations = "./migrations")]
async fn cleanup_deletes_only_bounded_expired_or_consumed_tokens_in_expiry_order(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool.clone(), mailer.clone());
    auth.register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO auth_tokens (user_id, token_hash, purpose, created_at, expires_at, consumed_at) VALUES ($1, repeat('b', 64), 'PASSWORD_RESET', now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour')")
        .bind(user_id).execute(&pool).await.unwrap();
    sqlx::query("UPDATE auth_tokens SET consumed_at = now() WHERE purpose = 'EMAIL_VERIFICATION'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(AuthService::cleanup_tokens(&pool, 1).await.unwrap(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM auth_tokens WHERE consumed_at IS NOT NULL OR expires_at <= now()"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn password_reset_is_single_use_and_revokes_sessions_transactionally(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool.clone(), mailer.clone());
    auth.register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let verification = mailer.verification.lock().unwrap()[0].1.clone();
    auth.verify_email(&verification).await.unwrap();
    let session = auth
        .login("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    auth.request_password_reset("alice@example.com")
        .await
        .unwrap();
    let reset = mailer.resets.lock().unwrap()[0].1.clone();
    auth.consume_password_reset(&reset, "replacement password correct")
        .await
        .unwrap();
    assert_eq!(
        auth.session(&session.raw_token).await,
        Err(AuthError::Unauthorized)
    );
    assert_eq!(
        auth.consume_password_reset(&reset, "another replacement password")
            .await,
        Err(AuthError::InvalidToken)
    );
    assert!(
        auth.login("alice@example.com", "replacement password correct")
            .await
            .is_ok()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM auth_tokens WHERE token_hash = $1")
            .bind(&reset)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}
