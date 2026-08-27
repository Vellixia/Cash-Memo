use std::{sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::auth::verify_current_password;
use crate::receipts::{DeletionReceipt, DeletionReceiptStore, hmac_user_id};

const DELETION_GRACE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Clone)]
struct VerifiedUserSnapshot {
    password_hash: String,
    status: String,
}

#[derive(Clone)]
pub struct AccountDeletionService {
    pool: PgPool,
    #[cfg(debug_assertions)]
    password_verification_hook: Option<Arc<PasswordVerificationHook>>,
}

#[cfg(debug_assertions)]
#[derive(Debug)]
pub struct PasswordVerificationHook {
    verified: tokio::sync::Barrier,
    resume: tokio::sync::Notify,
}

#[cfg(debug_assertions)]
impl Default for PasswordVerificationHook {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(debug_assertions)]
impl PasswordVerificationHook {
    pub fn new() -> Self {
        Self {
            verified: tokio::sync::Barrier::new(2),
            resume: tokio::sync::Notify::new(),
        }
    }

    pub async fn wait_until_verified(&self) {
        self.verified.wait().await;
    }

    pub fn resume(&self) {
        self.resume.notify_one();
    }

    async fn wait_after_verification(&self) {
        self.verified.wait().await;
        self.resume.notified().await;
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccountStatus {
    Active,
    PendingDeletion,
    Purging,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeletionStatus {
    pub status: AccountStatus,
    pub deletion_due_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeletionClaim {
    pub user_id: Uuid,
    pub purge_started_at: DateTime<Utc>,
    pub token: String,
    pub lease: Duration,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum AccountDeletionError {
    #[error("recent password confirmation is required")]
    RecentPasswordRequired,
    #[error("account is not pending deletion")]
    NotPending,
    #[error("account deletion persistence failed")]
    Persistence,
    #[error("purge claim is no longer held")]
    ClaimLost,
    #[error("deletion receipt failed")]
    Receipt,
}

impl AccountDeletionService {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            #[cfg(debug_assertions)]
            password_verification_hook: None,
        }
    }

    #[cfg(debug_assertions)]
    pub fn with_password_verification_hook(mut self, hook: Arc<PasswordVerificationHook>) -> Self {
        self.password_verification_hook = Some(hook);
        self
    }

    pub async fn request(
        &self,
        user_id: Uuid,
        password: &str,
    ) -> Result<DeletionStatus, AccountDeletionError> {
        let snapshot = self.verify_password_snapshot(user_id, password).await?;
        if snapshot.status != "active" {
            return Err(AccountDeletionError::NotPending);
        }
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| AccountDeletionError::Persistence)?;
        self.lock_verified_snapshot(&mut tx, user_id, &snapshot)
            .await?;
        sqlx::query(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AccountDeletionError::Persistence)?;
        let due: DateTime<Utc> = sqlx::query_scalar(
            "UPDATE users SET status = 'pending_deletion', deletion_requested_at = now(), deletion_due_at = now() + $2::interval, updated_at = now() WHERE id = $1 RETURNING deletion_due_at",
        ).bind(user_id).bind(duration_interval(DELETION_GRACE)).fetch_one(&mut *tx).await.map_err(|_| AccountDeletionError::Persistence)?;
        tx.commit()
            .await
            .map_err(|_| AccountDeletionError::Persistence)?;
        Ok(DeletionStatus {
            status: AccountStatus::PendingDeletion,
            deletion_due_at: Some(due),
        })
    }

    async fn verify_password_snapshot(
        &self,
        user_id: Uuid,
        password: &str,
    ) -> Result<VerifiedUserSnapshot, AccountDeletionError> {
        let row: Option<(String, String)> =
            sqlx::query_as("SELECT password_hash, status::TEXT FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| AccountDeletionError::Persistence)?;
        let Some((password_hash, status)) = row else {
            return Err(AccountDeletionError::RecentPasswordRequired);
        };
        if !verify_current_password(password, &password_hash) {
            return Err(AccountDeletionError::RecentPasswordRequired);
        }
        #[cfg(debug_assertions)]
        if let Some(hook) = &self.password_verification_hook {
            hook.wait_after_verification().await;
        }
        Ok(VerifiedUserSnapshot {
            password_hash,
            status,
        })
    }

    async fn lock_verified_snapshot(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        user_id: Uuid,
        snapshot: &VerifiedUserSnapshot,
    ) -> Result<(), AccountDeletionError> {
        let row: Option<(String, String)> = sqlx::query_as(
            "SELECT password_hash, status::TEXT FROM users WHERE id = $1 FOR UPDATE",
        )
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AccountDeletionError::Persistence)?;
        let Some((password_hash, status)) = row else {
            return Err(AccountDeletionError::RecentPasswordRequired);
        };
        if password_hash != snapshot.password_hash || status != snapshot.status {
            return Err(AccountDeletionError::RecentPasswordRequired);
        }
        Ok(())
    }

    pub async fn status(&self, user_id: Uuid) -> Result<DeletionStatus, AccountDeletionError> {
        let row: Option<(String, Option<DateTime<Utc>>)> =
            sqlx::query_as("SELECT status::TEXT, deletion_due_at FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| AccountDeletionError::Persistence)?;
        let Some((status, deletion_due_at)) = row else {
            return Err(AccountDeletionError::NotPending);
        };
        Ok(DeletionStatus {
            status: parse_status(&status)?,
            deletion_due_at,
        })
    }

    pub async fn cancel(&self, user_id: Uuid, password: &str) -> Result<(), AccountDeletionError> {
        let snapshot = self.verify_password_snapshot(user_id, password).await?;
        if snapshot.status != "pending_deletion" {
            return Err(AccountDeletionError::NotPending);
        }
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| AccountDeletionError::Persistence)?;
        self.lock_verified_snapshot(&mut tx, user_id, &snapshot)
            .await?;
        sqlx::query(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AccountDeletionError::Persistence)?;
        sqlx::query(
            "UPDATE users SET status = 'active', deletion_requested_at = NULL, deletion_due_at = NULL, updated_at = now() WHERE id = $1",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AccountDeletionError::Persistence)?;
        tx.commit()
            .await
            .map_err(|_| AccountDeletionError::Persistence)
    }

    pub async fn claim_next(
        &self,
        worker_token: &str,
        lease: Duration,
    ) -> Result<Option<DeletionClaim>, AccountDeletionError> {
        let row: Option<(Uuid, DateTime<Utc>, String)> = sqlx::query_as(
            "WITH candidate AS (\
                SELECT id FROM users \
                WHERE (status = 'pending_deletion' AND deletion_due_at <= now()) \
                   OR (status = 'purging' AND (purge_claimed_until IS NULL OR purge_claimed_until <= now())) \
                ORDER BY COALESCE(purge_started_at, deletion_due_at), id \
                FOR UPDATE SKIP LOCKED LIMIT 1\
             ) \
             UPDATE users SET status = 'purging', purge_started_at = COALESCE(purge_started_at, now()), \
                 purge_claim_token = $1, purge_claimed_until = now() + $2::interval \
             WHERE id = (SELECT id FROM candidate) \
             RETURNING id, purge_started_at, purge_claim_token",
        ).bind(worker_token).bind(duration_interval(lease)).fetch_optional(&self.pool).await.map_err(|_| AccountDeletionError::Persistence)?;
        Ok(row.map(|(user_id, purge_started_at, token)| DeletionClaim {
            user_id,
            purge_started_at,
            token,
            lease,
        }))
    }

    pub async fn purge_claim(
        &self,
        claim: &DeletionClaim,
        hmac_key: &[u8],
        key_version: u32,
        receipts: &dyn DeletionReceiptStore,
    ) -> Result<(), AccountDeletionError> {
        let renewed: Option<DateTime<Utc>> = sqlx::query_scalar(
            "UPDATE users SET purge_claimed_until = now() + $3::interval \
             WHERE id = $1 AND status = 'purging' AND purge_claim_token = $2 \
               AND purge_claimed_until > now() \
             RETURNING purge_claimed_until",
        )
        .bind(claim.user_id)
        .bind(&claim.token)
        .bind(duration_interval(claim.lease))
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| AccountDeletionError::Persistence)?;
        if renewed.is_none() {
            return Err(AccountDeletionError::ClaimLost);
        }
        let receipt = DeletionReceipt::new(
            hmac_user_id(hmac_key, claim.user_id).map_err(|_| AccountDeletionError::Receipt)?,
            claim.purge_started_at,
            key_version,
        );
        receipts
            .put_receipt(&receipt)
            .await
            .map_err(|_| AccountDeletionError::Receipt)?;
        let deleted = sqlx::query(
            "DELETE FROM users WHERE id = $1 AND status = 'purging' AND purge_claim_token = $2 AND purge_claimed_until > now()",
        )
        .bind(claim.user_id)
        .bind(&claim.token)
        .execute(&self.pool)
        .await
        .map_err(|_| AccountDeletionError::Persistence)?;
        if deleted.rows_affected() == 1 {
            Ok(())
        } else {
            Err(AccountDeletionError::ClaimLost)
        }
    }
}

fn parse_status(status: &str) -> Result<AccountStatus, AccountDeletionError> {
    match status {
        "active" => Ok(AccountStatus::Active),
        "pending_deletion" => Ok(AccountStatus::PendingDeletion),
        "purging" => Ok(AccountStatus::Purging),
        _ => Err(AccountDeletionError::NotPending),
    }
}

fn duration_interval(duration: Duration) -> String {
    format!("{} seconds", duration.as_secs())
}
