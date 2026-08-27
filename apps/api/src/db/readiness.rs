use sqlx::PgPool;
use thiserror::Error;

use super::target_guard::{TargetError, TargetState, assert_latest_v1_migration_target};

#[derive(Debug, Error)]
pub enum ReadinessError {
    #[error("database is not at current Cashmemo V1 migration state")]
    NotCurrentV1,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Verifies schema identity and every applied V1 migration with SELECT-only queries.
pub async fn check_latest_v1_readiness(pool: &PgPool) -> Result<(), ReadinessError> {
    match assert_latest_v1_migration_target(pool).await {
        Ok(TargetState::CashmemoV1) => Ok(()),
        Ok(TargetState::Empty) | Err(TargetError::UnknownNonEmpty) => {
            Err(ReadinessError::NotCurrentV1)
        }
        Err(TargetError::Database(error)) => Err(ReadinessError::Database(error)),
    }
}
