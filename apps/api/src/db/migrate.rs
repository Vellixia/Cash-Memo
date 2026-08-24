use sqlx::PgPool;

use crate::error::ApiError;

use super::target_guard::{
    TargetState, assert_latest_v1_migration_target, assert_v1_migration_target,
};

pub async fn migrate_v1(pool: &PgPool) -> Result<TargetState, ApiError> {
    assert_v1_migration_target(pool).await?;
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(assert_latest_v1_migration_target(pool).await?)
}
