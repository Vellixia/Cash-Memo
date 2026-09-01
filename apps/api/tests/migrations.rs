mod support;

use cashmemo_api::db::{
    migrate::migrate_v1,
    readiness::check_latest_v1_readiness,
    target_guard::{
        TargetError, TargetState, assert_latest_v1_migration_target, assert_v1_migration_target,
    },
};
use sqlx::PgPool;

#[sqlx::test(migrations = false)]
async fn unknown_non_empty_database_is_rejected(pool: PgPool) {
    sqlx::query("CREATE TABLE alien_data(id bigint primary key)")
        .execute(&pool)
        .await
        .unwrap();

    assert!(matches!(
        assert_v1_migration_target(&pool).await,
        Err(TargetError::UnknownNonEmpty)
    ));
}

#[sqlx::test(migrations = false)]
async fn empty_or_identified_v1_database_is_allowed(pool: PgPool) {
    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::Empty
    );
    assert!(check_latest_v1_readiness(&pool).await.is_err());

    support::migrate_v1(&pool).await;

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
    assert_eq!(
        assert_latest_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
    check_latest_v1_readiness(&pool).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_at_0001_is_allowed_to_continue_migrating(pool: PgPool) {
    sqlx::query(
        "CREATE TABLE _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),
            success BOOLEAN NOT NULL,
            checksum BYTEA NOT NULL,
            execution_time BIGINT NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0001_v1_identity.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let checksum = sqlx::migrate!("./migrations")
        .iter()
        .find(|migration| migration.version == 1)
        .unwrap()
        .checksum
        .to_vec();
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
         VALUES (1, 'v1 identity', TRUE, $1, 0)",
    )
    .bind(checksum)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_at_0004_upgrades_to_latest(pool: PgPool) {
    support::migrate_v1(&pool).await;
    rollback_0009(&pool).await;
    rollback_0008(&pool).await;
    sqlx::query("DROP TRIGGER wallets_opening_balance_immutable ON wallets")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION reject_wallet_opening_balance_change()")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP INDEX transactions_active_history_order_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP INDEX transactions_trash_purge_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version >= 5")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
    assert_eq!(migrate_v1(&pool).await.unwrap(), TargetState::CashmemoV1);

    let migrations: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(migrations, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_at_0005_upgrades_to_latest(pool: PgPool) {
    support::migrate_v1(&pool).await;
    rollback_0009(&pool).await;
    rollback_0008(&pool).await;
    sqlx::query("DROP INDEX transactions_active_history_order_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP INDEX transactions_trash_purge_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP TRIGGER recurring_occurrences_immutable ON recurring_occurrences")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION reject_recurring_occurrence_mutation()")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP INDEX recurring_transactions_due_active_idx")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version >= 6")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
    assert_eq!(migrate_v1(&pool).await.unwrap(), TargetState::CashmemoV1);

    let migrations: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(migrations, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_at_0007_upgrades_to_latest(pool: PgPool) {
    support::migrate_v1(&pool).await;
    rollback_0009(&pool).await;
    rollback_0008(&pool).await;
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version >= 8")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
    assert!(matches!(
        assert_latest_v1_migration_target(&pool).await,
        Err(TargetError::UnknownNonEmpty)
    ));
    assert_eq!(migrate_v1(&pool).await.unwrap(), TargetState::CashmemoV1);
    let migrations: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(migrations, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_at_0009_upgrades_occurrence_purge_guard(pool: PgPool) {
    support::migrate_v1(&pool).await;
    rollback_0010(&pool).await;
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version = 10")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
    assert!(matches!(
        assert_latest_v1_migration_target(&pool).await,
        Err(TargetError::UnknownNonEmpty)
    ));
    assert_eq!(migrate_v1(&pool).await.unwrap(), TargetState::CashmemoV1);
    check_latest_v1_readiness(&pool).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn migration_0009_removes_opening_balance_guard_and_backfills_completed_users(pool: PgPool) {
    support::migrate_v1(&pool).await;
    rollback_0010(&pool).await;
    rollback_0009(&pool).await;
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version >= 9")
        .execute(&pool)
        .await
        .unwrap();
    let active_user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users
         (email, password_hash, status, timezone, timezone_configured_at, default_currency_code)
         VALUES ('migration-active@example.test', 'hash', 'active', 'Asia/Jakarta', now(), 'IDR')
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let archived_user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users
         (email, password_hash, status, timezone, timezone_configured_at, default_currency_code)
         VALUES ('migration-archived@example.test', 'hash', 'active', 'UTC', now(), 'USD')
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let no_wallet_user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users
         (email, password_hash, status, timezone, timezone_configured_at, default_currency_code)
         VALUES ('migration-no-wallet@example.test', 'hash', 'active', 'UTC', now(), 'USD')
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance, archived_at)
         VALUES ($1, 'Active', 'IDR', 0, NULL), ($2, 'Archived', 'USD', 0, now())",
    )
    .bind(active_user)
    .bind(archived_user)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(migrate_v1(&pool).await.unwrap(), TargetState::CashmemoV1);

    let completed: Vec<(uuid::Uuid, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT id, onboarding_completed_at FROM users
         WHERE id = ANY($1) ORDER BY id",
    )
    .bind(vec![active_user, archived_user, no_wallet_user])
    .fetch_all(&pool)
    .await
    .unwrap();
    let active_completed = completed
        .iter()
        .find(|(id, _)| *id == active_user)
        .unwrap()
        .1;
    let archived_completed = completed
        .iter()
        .find(|(id, _)| *id == archived_user)
        .unwrap()
        .1;
    let no_wallet_completed = completed
        .iter()
        .find(|(id, _)| *id == no_wallet_user)
        .unwrap()
        .1;
    assert!(active_completed.is_some());
    assert_eq!(archived_completed, active_completed);
    assert!(no_wallet_completed.is_none());
    let trigger_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'wallets_opening_balance_immutable' AND NOT tgisinternal
         )",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!trigger_exists);
    let function_exists: bool = sqlx::query_scalar(
        "SELECT to_regprocedure('reject_wallet_opening_balance_change()') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!function_exists);
}

async fn rollback_0009(pool: &PgPool) {
    sqlx::raw_sql(
        "CREATE OR REPLACE FUNCTION reject_wallet_opening_balance_change() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
             IF NEW.opening_balance IS DISTINCT FROM OLD.opening_balance THEN
                 RAISE EXCEPTION 'wallet opening balance is immutable';
             END IF;
             RETURN NEW;
         END;
         $$;
         DROP TRIGGER IF EXISTS wallets_opening_balance_immutable ON wallets;
         CREATE TRIGGER wallets_opening_balance_immutable
             BEFORE UPDATE OF opening_balance ON wallets
             FOR EACH ROW EXECUTE FUNCTION reject_wallet_opening_balance_change();
         ALTER TABLE users DROP COLUMN IF EXISTS onboarding_completed_at;",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn rollback_0010(pool: &PgPool) {
    sqlx::raw_sql(
        "CREATE OR REPLACE FUNCTION reject_recurring_occurrence_mutation()
         RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
             RAISE EXCEPTION 'recurring occurrences are immutable';
         END;
         $$;",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn rollback_0008(pool: &PgPool) {
    sqlx::query("DROP INDEX users_deletion_purge_candidates_idx")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE users DROP COLUMN deletion_requested_at, DROP COLUMN deletion_due_at, DROP COLUMN purge_started_at, DROP COLUMN purge_claim_token, DROP COLUMN purge_claimed_until")
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_with_migration_gap_is_rejected(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version = 4")
        .execute(&pool)
        .await
        .unwrap();

    assert!(matches!(
        assert_v1_migration_target(&pool).await,
        Err(TargetError::UnknownNonEmpty)
    ));
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_with_modified_migration_is_rejected(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query("UPDATE _sqlx_migrations SET checksum = '\\x00' WHERE version = 10")
        .execute(&pool)
        .await
        .unwrap();

    assert!(matches!(
        assert_v1_migration_target(&pool).await,
        Err(TargetError::UnknownNonEmpty)
    ));
}
