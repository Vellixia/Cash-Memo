use std::{sync::Arc, time::Duration};

use cashmemo_api::{
    accounts::{AccountDeletionError, AccountDeletionService, AccountStatus},
    auth::{AuthConfig, AuthService, SessionAccess, UnconfiguredEmailSender},
};
use sqlx::PgPool;

fn auth(pool: PgPool) -> AuthService {
    AuthService::new(pool, Arc::new(UnconfiguredEmailSender), AuthConfig::for_tests())
}

async fn active_account(pool: &PgPool) -> (AuthService, uuid::Uuid) {
    let auth = auth(pool.clone());
    auth.register("delete-me@example.com", "correct horse battery staple").await.unwrap();
    let user_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "UPDATE users SET email_verified = TRUE, status = 'active' WHERE email = 'delete-me@example.com' RETURNING id",
    ).fetch_one(pool).await.unwrap();
    (auth, user_id)
}

#[sqlx::test(migrations = "./migrations")]
async fn recent_password_starts_seven_day_deletion_and_revokes_all_sessions(pool: PgPool) {
    let (auth, user_id) = active_account(&pool).await;
    let first = auth.login("delete-me@example.com", "correct horse battery staple").await.unwrap();
    let second = auth.login("delete-me@example.com", "correct horse battery staple").await.unwrap();
    let deletion = AccountDeletionService::new(pool.clone());

    assert_eq!(deletion.request(user_id, "wrong password").await, Err(AccountDeletionError::RecentPasswordRequired));
    let status = deletion.request(user_id, "correct horse battery staple").await.unwrap();

    assert_eq!(status.status, AccountStatus::PendingDeletion);
    let due = status.deletion_due_at.unwrap();
    assert!(due > chrono::Utc::now() + chrono::Duration::days(6));
    assert!(due <= chrono::Utc::now() + chrono::Duration::days(8));
    assert!(auth.session(&first.raw_token).await.is_err());
    assert!(auth.session(&second.raw_token).await.is_err());
    assert_eq!(auth.login("delete-me@example.com", "correct horse battery staple").await.unwrap().access, SessionAccess::DeletionOnly);
}

#[sqlx::test(migrations = "./migrations")]
async fn claim_is_atomic_and_cancellation_fails_after_purging(pool: PgPool) {
    let (_auth, user_id) = active_account(&pool).await;
    let deletion = AccountDeletionService::new(pool.clone());
    deletion.request(user_id, "correct horse battery staple").await.unwrap();
    sqlx::query("UPDATE users SET deletion_due_at = now() - INTERVAL '1 second' WHERE id = $1")
        .bind(user_id).execute(&pool).await.unwrap();

    let (first, second) = tokio::join!(
        deletion.claim_next("worker-one", Duration::from_secs(30)),
        deletion.claim_next("worker-two", Duration::from_secs(30)),
    );
    assert_eq!(usize::from(first.unwrap().is_some()) + usize::from(second.unwrap().is_some()), 1);
    assert_eq!(deletion.cancel(user_id).await, Err(AccountDeletionError::NotPending));
}
