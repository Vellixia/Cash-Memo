mod support;

use cashmemo_api::db::{
    migrate::migrate_v1,
    target_guard::{TargetError, TargetState, assert_v1_migration_target},
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

    support::migrate_v1(&pool).await;

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
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
    assert_eq!(migrations, vec![1, 2, 3, 4, 5, 6, 7]);
}

#[sqlx::test(migrations = false)]
async fn identified_v1_database_at_0005_upgrades_to_latest(pool: PgPool) {
    support::migrate_v1(&pool).await;
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
    assert_eq!(migrations, vec![1, 2, 3, 4, 5, 6, 7]);
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
    sqlx::query("UPDATE _sqlx_migrations SET checksum = '\\x00' WHERE version = 5")
        .execute(&pool)
        .await
        .unwrap();

    assert!(matches!(
        assert_v1_migration_target(&pool).await,
        Err(TargetError::UnknownNonEmpty)
    ));
}
