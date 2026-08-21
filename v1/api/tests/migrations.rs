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
