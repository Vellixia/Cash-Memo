mod support;

use cashmemo_api::db::target_guard::{TargetError, TargetState, assert_v1_migration_target};
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
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
         VALUES (1, 'v1 identity', TRUE, '\\x00', 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        assert_v1_migration_target(&pool).await.unwrap(),
        TargetState::CashmemoV1
    );
}
