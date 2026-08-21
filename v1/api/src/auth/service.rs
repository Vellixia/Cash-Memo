use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use rand::Rng;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use thiserror::Error;
use uuid::Uuid;

use super::{
    email::EmailSender,
    model::{AuthConfig, AuthSession, LoginSession, SessionAccess},
    password::{hash_password, validate_password, verify_password},
};

const EMAIL_VERIFICATION: &str = "EMAIL_VERIFICATION";
const PASSWORD_RESET: &str = "PASSWORD_RESET";
const VERIFICATION_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const RESET_TTL: Duration = Duration::from_secs(30 * 60);

type SessionRow = (
    Uuid,
    Uuid,
    String,
    DateTime<Utc>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Clone)]
pub struct AuthService {
    pool: PgPool,
    mailer: Arc<dyn EmailSender>,
    config: AuthConfig,
    dummy_password_hash: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AuthError {
    #[error("invalid credentials")]
    InvalidCredentials,
    #[error("email is not verified")]
    EmailNotVerified,
    #[error("account is unavailable")]
    AccountUnavailable,
    #[error("token is invalid")]
    InvalidToken,
    #[error("authentication required")]
    Unauthorized,
    #[error("input is invalid")]
    Validation,
    #[error("authentication persistence failed")]
    Persistence,
}

impl AuthService {
    pub fn new(pool: PgPool, mailer: Arc<dyn EmailSender>, config: AuthConfig) -> Self {
        let dummy_password_hash =
            hash_password("correct horse battery staple", &config.password_hash)
                .expect("approved dummy password configuration");
        Self {
            pool,
            mailer,
            config,
            dummy_password_hash,
        }
    }

    pub async fn register(&self, email: &str, password: &str) -> Result<(), AuthError> {
        let started = Instant::now();
        validate_email(email)?;
        validate_password(password).map_err(|_| AuthError::Validation)?;
        let email = normalize_email(email);
        let candidate_password_hash = hash_password(password, &self.config.password_hash)
            .map_err(|_| AuthError::Validation)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| AuthError::Persistence)?;
        let existing: Option<(Uuid, bool)> =
            sqlx::query_as("SELECT id, email_verified FROM users WHERE email = $1 FOR UPDATE")
                .bind(&email)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|_| AuthError::Persistence)?;

        let token = match existing {
            Some((user_id, false)) => Some(
                self.create_token(
                    &mut transaction,
                    user_id,
                    EMAIL_VERIFICATION,
                    VERIFICATION_TTL,
                )
                .await?,
            ),
            Some((_, true)) => None,
            None => {
                let user_id: Uuid = sqlx::query_scalar(
                    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
                )
                .bind(&email)
                .bind(candidate_password_hash)
                .fetch_one(&mut *transaction)
                .await
                .map_err(|_| AuthError::Persistence)?;
                Some(
                    self.create_token(
                        &mut transaction,
                        user_id,
                        EMAIL_VERIFICATION,
                        VERIFICATION_TTL,
                    )
                    .await?,
                )
            }
        };
        transaction
            .commit()
            .await
            .map_err(|_| AuthError::Persistence)?;
        if let Some(token) = token {
            self.queue_verification(email.clone(), token);
        }
        self.finish_public_response(started).await;
        Ok(())
    }

    pub async fn resend_verification(&self, email: &str) -> Result<(), AuthError> {
        let started = Instant::now();
        validate_email(email)?;
        let email = normalize_email(email);
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| AuthError::Persistence)?;
        let user_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM users WHERE email = $1 AND NOT email_verified FOR UPDATE",
        )
        .bind(&email)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| AuthError::Persistence)?;
        let token = if let Some(user_id) = user_id {
            Some(
                self.create_token(
                    &mut transaction,
                    user_id,
                    EMAIL_VERIFICATION,
                    VERIFICATION_TTL,
                )
                .await?,
            )
        } else {
            None
        };
        transaction
            .commit()
            .await
            .map_err(|_| AuthError::Persistence)?;
        if let Some(token) = token {
            self.queue_verification(email.clone(), token);
        }
        self.finish_public_response(started).await;
        Ok(())
    }

    pub async fn verify_email(&self, raw_token: &str) -> Result<(), AuthError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| AuthError::Persistence)?;
        let user_id = self
            .consume_token(&mut transaction, raw_token, EMAIL_VERIFICATION)
            .await?;
        sqlx::query("UPDATE users SET email_verified = TRUE, status = 'active', updated_at = now() WHERE id = $1")
            .bind(user_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| AuthError::Persistence)?;
        transaction
            .commit()
            .await
            .map_err(|_| AuthError::Persistence)
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<LoginSession, AuthError> {
        validate_email(email)?;
        let email = normalize_email(email);
        let user: Option<(Uuid, String, bool, String)> = sqlx::query_as(
            "SELECT id, password_hash, email_verified, status::TEXT FROM users WHERE email = $1",
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| AuthError::Persistence)?;
        let password_hash = self.login_password_hash(
            user.as_ref()
                .map(|(_, password_hash, _, _)| password_hash.as_str()),
        );
        if !verify_password(password, password_hash) {
            return Err(AuthError::InvalidCredentials);
        }
        let Some((user_id, _, email_verified, status)) = user else {
            return Err(AuthError::InvalidCredentials);
        };
        if !email_verified {
            return Err(AuthError::EmailNotVerified);
        }
        if status == "purging" {
            return Err(AuthError::AccountUnavailable);
        }
        let raw_token = random_token();
        let session_id: Uuid = sqlx::query_scalar(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + $3::interval) RETURNING id",
        )
        .bind(user_id)
        .bind(token_hash(&raw_token))
        .bind(duration_interval(self.config.idle_timeout))
        .fetch_one(&self.pool)
        .await
        .map_err(|_| AuthError::Persistence)?;
        let access = if status == "pending_deletion" {
            SessionAccess::DeletionOnly
        } else {
            SessionAccess::Full
        };
        Ok(LoginSession {
            user_id,
            session_id,
            access,
            raw_token,
        })
    }

    pub async fn session(&self, raw_token: &str) -> Result<AuthSession, AuthError> {
        self.session_for_hash(&token_hash(raw_token)).await
    }

    pub async fn session_for_hash(&self, hash: &str) -> Result<AuthSession, AuthError> {
        let row: Option<SessionRow> = sqlx::query_as(
            "SELECT s.id, s.user_id, u.status::TEXT, s.created_at, s.last_seen_at, s.expires_at \
             FROM sessions s JOIN users u ON u.id = s.user_id \
             WHERE s.token_hash = $1 AND s.revoked_at IS NULL FOR UPDATE",
        )
        .bind(hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| AuthError::Persistence)?;
        let Some((session_id, user_id, status, created_at, last_seen_at, expires_at)) = row else {
            return Err(AuthError::Unauthorized);
        };
        let now = Utc::now();
        let absolute_expires_at = created_at + chrono_duration(self.config.absolute_timeout);
        if expires_at <= now || absolute_expires_at <= now || status == "purging" {
            sqlx::query(
                "UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
            )
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(|_| AuthError::Persistence)?;
            return Err(AuthError::Unauthorized);
        }
        if now - last_seen_at >= chrono_duration(self.config.touch_interval) {
            let next_idle_expiry = now + chrono_duration(self.config.idle_timeout);
            sqlx::query("UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1")
                .bind(session_id)
                .bind(next_idle_expiry.min(absolute_expires_at))
                .execute(&self.pool)
                .await
                .map_err(|_| AuthError::Persistence)?;
        }
        let access = if status == "pending_deletion" {
            SessionAccess::DeletionOnly
        } else {
            SessionAccess::Full
        };
        Ok(AuthSession {
            user_id,
            session_id,
            access,
        })
    }

    pub async fn logout(&self, raw_token: &str) -> Result<(), AuthError> {
        sqlx::query(
            "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        )
        .bind(token_hash(raw_token))
        .execute(&self.pool)
        .await
        .map_err(|_| AuthError::Persistence)?;
        Ok(())
    }

    pub async fn revoke_all(&self, user_id: Uuid) -> Result<(), AuthError> {
        sqlx::query(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|_| AuthError::Persistence)?;
        Ok(())
    }

    pub async fn request_password_reset(&self, email: &str) -> Result<(), AuthError> {
        let started = Instant::now();
        validate_email(email)?;
        let email = normalize_email(email);
        let _ = verify_password("not-a-cashmemo-password", self.login_password_hash(None));
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| AuthError::Persistence)?;
        let user_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM users WHERE email = $1 AND email_verified AND status IN ('active', 'pending_deletion') FOR UPDATE",
        )
        .bind(&email).fetch_optional(&mut *transaction).await.map_err(|_| AuthError::Persistence)?;
        let token = if let Some(user_id) = user_id {
            Some(
                self.create_token(&mut transaction, user_id, PASSWORD_RESET, RESET_TTL)
                    .await?,
            )
        } else {
            None
        };
        transaction
            .commit()
            .await
            .map_err(|_| AuthError::Persistence)?;
        if let Some(token) = token {
            self.queue_password_reset(email.clone(), token);
        }
        self.finish_public_response(started).await;
        Ok(())
    }

    pub async fn consume_password_reset(
        &self,
        raw_token: &str,
        password: &str,
    ) -> Result<(), AuthError> {
        validate_password(password).map_err(|_| AuthError::Validation)?;
        let password_hash = hash_password(password, &self.config.password_hash)
            .map_err(|_| AuthError::Validation)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| AuthError::Persistence)?;
        let user_id = self
            .consume_token(&mut transaction, raw_token, PASSWORD_RESET)
            .await?;
        sqlx::query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1")
            .bind(user_id)
            .bind(password_hash)
            .execute(&mut *transaction)
            .await
            .map_err(|_| AuthError::Persistence)?;
        sqlx::query(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| AuthError::Persistence)?;
        transaction
            .commit()
            .await
            .map_err(|_| AuthError::Persistence)
    }

    pub async fn cleanup_tokens(pool: &PgPool, batch_size: i64) -> Result<u64, AuthError> {
        if batch_size <= 0 {
            return Err(AuthError::Validation);
        }
        sqlx::query("DELETE FROM auth_tokens WHERE id IN (SELECT id FROM auth_tokens WHERE consumed_at IS NOT NULL OR expires_at <= now() ORDER BY expires_at, id LIMIT $1)")
            .bind(batch_size).execute(pool).await.map(|result| result.rows_affected()).map_err(|_| AuthError::Persistence)
    }

    async fn create_token(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        user_id: Uuid,
        purpose: &str,
        ttl: Duration,
    ) -> Result<String, AuthError> {
        sqlx::query("UPDATE auth_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose = $2::auth_token_purpose AND consumed_at IS NULL")
            .bind(user_id).bind(purpose).execute(&mut **transaction).await.map_err(|_| AuthError::Persistence)?;
        let raw_token = random_token();
        sqlx::query("INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3::auth_token_purpose, now() + $4::interval)")
            .bind(user_id).bind(token_hash(&raw_token)).bind(purpose).bind(duration_interval(ttl))
            .execute(&mut **transaction).await.map_err(|_| AuthError::Persistence)?;
        Ok(raw_token)
    }

    async fn consume_token(
        &self,
        transaction: &mut Transaction<'_, Postgres>,
        raw_token: &str,
        purpose: &str,
    ) -> Result<Uuid, AuthError> {
        let user_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND purpose = $2::auth_token_purpose AND consumed_at IS NULL AND expires_at > now() FOR UPDATE",
        )
        .bind(token_hash(raw_token)).bind(purpose).fetch_optional(&mut **transaction).await.map_err(|_| AuthError::Persistence)?;
        let Some(user_id) = user_id else {
            return Err(AuthError::InvalidToken);
        };
        sqlx::query("UPDATE auth_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL")
            .bind(token_hash(raw_token)).execute(&mut **transaction).await.map_err(|_| AuthError::Persistence)?;
        Ok(user_id)
    }

    fn login_password_hash<'a>(&'a self, stored: Option<&'a str>) -> &'a str {
        stored.unwrap_or(&self.dummy_password_hash)
    }

    fn queue_verification(&self, email: String, raw_token: String) {
        let mailer = self.mailer.clone();
        tokio::spawn(async move {
            let _ = mailer.send_verification(&email, &raw_token).await;
        });
    }

    fn queue_password_reset(&self, email: String, raw_token: String) {
        let mailer = self.mailer.clone();
        tokio::spawn(async move {
            let _ = mailer.send_password_reset(&email, &raw_token).await;
        });
    }

    async fn finish_public_response(&self, started: Instant) {
        if let Some(remaining) = self
            .config
            .public_response_floor
            .checked_sub(started.elapsed())
        {
            tokio::time::sleep(remaining).await;
        }
    }
}

pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn validate_email(email: &str) -> Result<(), AuthError> {
    let email = normalize_email(email);
    if email.is_empty() || !email.contains('@') {
        Err(AuthError::Validation)
    } else {
        Ok(())
    }
}

fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill(&mut bytes);
    base64_url(&bytes)
}

fn base64_url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(43);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        output.push(ALPHABET[((value >> 18) & 63) as usize] as char);
        output.push(ALPHABET[((value >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            output.push(ALPHABET[((value >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            output.push(ALPHABET[(value & 63) as usize] as char);
        }
    }
    output
}

fn token_hash(raw_token: &str) -> String {
    format!("{:x}", Sha256::digest(raw_token.as_bytes()))
}

fn duration_interval(duration: Duration) -> String {
    format!("{} seconds", duration.as_secs())
}

fn chrono_duration(duration: Duration) -> chrono::Duration {
    chrono::Duration::from_std(duration).expect("configured duration fits chrono")
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    #[tokio::test]
    async fn missing_login_uses_valid_argon2id_dummy_hash() {
        let config = AuthConfig::new(
            Duration::from_secs(7 * 24 * 60 * 60),
            Duration::from_secs(30 * 24 * 60 * 60),
            Duration::from_secs(60 * 60),
            super::super::password::Argon2idConfig::new(131_072, 3, 1).unwrap(),
        )
        .unwrap();
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://cashmemo:cashmemo@127.0.0.1:1/cashmemo")
            .unwrap();
        let service = AuthService::new(
            pool,
            Arc::new(super::super::email::UnconfiguredEmailSender),
            config,
        );
        assert!(service.dummy_password_hash.contains("m=131072,t=3,p=1"));
        assert!(verify_password(
            "correct horse battery staple",
            &service.dummy_password_hash,
        ));
    }
}
