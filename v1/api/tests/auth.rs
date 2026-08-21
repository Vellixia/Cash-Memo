use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use cashmemo_api::auth::email::SmtpEmailSender;
use cashmemo_api::auth::{
    Argon2idConfig, AuthConfig, AuthConfigError, AuthError, AuthService, EmailError, EmailSender,
    PasswordError, SessionAccess, normalize_email, validate_password,
};
use cashmemo_api::config::{AppEnvironment, SmtpEmailConfig, SmtpSecurity};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[derive(Default)]
struct FakeEmailSender {
    verification: Mutex<Vec<(String, String)>>,
    resets: Mutex<Vec<(String, String)>>,
}

struct FailingEmailSender;

#[async_trait::async_trait]
impl EmailSender for FailingEmailSender {
    async fn send_verification(&self, _: &str, _: &str) -> Result<(), EmailError> {
        Err(EmailError::Delivery)
    }

    async fn send_password_reset(&self, _: &str, _: &str) -> Result<(), EmailError> {
        Err(EmailError::Delivery)
    }
}

struct DelayedEmailSender(std::time::Duration);

#[async_trait::async_trait]
impl EmailSender for DelayedEmailSender {
    async fn send_verification(&self, _: &str, _: &str) -> Result<(), EmailError> {
        tokio::time::sleep(self.0).await;
        Ok(())
    }

    async fn send_password_reset(&self, _: &str, _: &str) -> Result<(), EmailError> {
        tokio::time::sleep(self.0).await;
        Ok(())
    }
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

async fn sent_token(sent: &Mutex<Vec<(String, String)>>, index: usize) -> String {
    for _ in 0..200 {
        if let Some((_, token)) = sent.lock().unwrap().get(index) {
            return token.clone();
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    panic!("timed out waiting for email token {index}");
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

#[test]
fn auth_configuration_keeps_argon2id_tunable_but_session_limits_hard_bounded() {
    let password_hash = Argon2idConfig::new(65_536, 3, 1).unwrap();
    assert_eq!(password_hash.memory_cost_kib(), 65_536);
    assert!(Argon2idConfig::new(65_535, 3, 1).is_err());
    assert!(
        AuthConfig::new(
            std::time::Duration::from_secs(7 * 24 * 60 * 60 + 1),
            std::time::Duration::from_secs(30 * 24 * 60 * 60),
            std::time::Duration::from_secs(60 * 60),
            password_hash.clone(),
        )
        .is_err()
    );
    assert_eq!(
        AuthConfig::new(
            std::time::Duration::from_secs(7 * 24 * 60 * 60),
            std::time::Duration::from_secs(30 * 24 * 60 * 60 + 1),
            std::time::Duration::from_secs(60 * 60),
            password_hash,
        ),
        Err(AuthConfigError::AbsoluteTimeoutTooLong),
    );
}

#[test]
fn smtp_security_mode_requires_explicit_plaintext_for_mailpit() {
    let mailpit = SmtpEmailConfig {
        host: "127.0.0.1".to_owned(),
        port: 1025,
        username: None,
        password: None,
        from: "noreply@example.com".to_owned(),
        security: SmtpSecurity::Plaintext,
    };
    assert!(
        mailpit
            .validate_for_environment(AppEnvironment::Development)
            .is_ok()
    );
    assert!(
        mailpit
            .validate_for_environment(AppEnvironment::Production)
            .is_err()
    );
    assert!(
        SmtpEmailConfig {
            host: "smtp.example.test".to_owned(),
            ..mailpit.clone()
        }
        .validate_for_environment(AppEnvironment::Development)
        .is_err()
    );
    assert!(SmtpEmailSender::new(&mailpit).is_ok());
    assert_eq!(SmtpSecurity::default(), SmtpSecurity::StartTls);
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

    let raw = sent_token(&mailer.verification, 0).await;
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
async fn registration_and_reset_keep_generic_success_when_delivery_fails(pool: PgPool) {
    let working_mailer = Arc::new(FakeEmailSender::default());
    let working = service(pool.clone(), working_mailer.clone());
    working
        .register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let verification = sent_token(&working_mailer.verification, 0).await;
    working.verify_email(&verification).await.unwrap();

    let failing = AuthService::new(pool, Arc::new(FailingEmailSender), AuthConfig::for_tests());
    assert!(
        failing
            .request_password_reset("alice@example.com")
            .await
            .is_ok()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn resend_uses_common_public_response_deadline_without_waiting_for_smtp(pool: PgPool) {
    let setup_mailer = Arc::new(FakeEmailSender::default());
    let setup = service(pool.clone(), setup_mailer);
    setup
        .register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let config =
        AuthConfig::for_tests().with_public_response_floor(std::time::Duration::from_millis(20));
    let delayed = AuthService::new(
        pool,
        Arc::new(DelayedEmailSender(std::time::Duration::from_millis(500))),
        config,
    );
    let started = std::time::Instant::now();
    delayed
        .resend_verification("alice@example.com")
        .await
        .unwrap();
    assert!(started.elapsed() < std::time::Duration::from_millis(200));
}

#[sqlx::test(migrations = "./migrations")]
async fn verification_tokens_are_replaced_single_use_and_expiring(pool: PgPool) {
    let mailer = Arc::new(FakeEmailSender::default());
    let auth = service(pool.clone(), mailer.clone());
    auth.register("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    let first = sent_token(&mailer.verification, 0).await;
    auth.resend_verification("alice@example.com").await.unwrap();
    let second = sent_token(&mailer.verification, 1).await;
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
    let token = sent_token(&mailer.verification, 0).await;
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
    let verification = sent_token(&mailer.verification, 0).await;
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
    let verification = sent_token(&mailer.verification, 0).await;
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
    let verification = sent_token(&mailer.verification, 0).await;
    auth.verify_email(&verification).await.unwrap();
    let session = auth
        .login("alice@example.com", "correct horse battery staple")
        .await
        .unwrap();
    auth.request_password_reset("alice@example.com")
        .await
        .unwrap();
    let reset = sent_token(&mailer.resets, 0).await;
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
