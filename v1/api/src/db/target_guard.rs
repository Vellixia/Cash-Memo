use sqlx::PgPool;
use thiserror::Error;

const IDENTITY_TABLE: &str = "cashmemo_schema_identity";
const MIGRATIONS_TABLE: &str = "_sqlx_migrations";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetState {
    Empty,
    CashmemoV1,
}

#[derive(Debug, Error)]
pub enum TargetError {
    #[error("migration target contains unknown tables")]
    UnknownNonEmpty,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

pub async fn assert_v1_migration_target(pool: &PgPool) -> Result<TargetState, TargetError> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT tablename
         FROM pg_catalog.pg_tables
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY tablename",
    )
    .fetch_all(pool)
    .await?;

    if tables.is_empty() {
        return Ok(TargetState::Empty);
    }

    if tables.as_slice() != [MIGRATIONS_TABLE, IDENTITY_TABLE] {
        return Err(TargetError::UnknownNonEmpty);
    }

    let identity: Option<(String, String)> = sqlx::query_as(
        "SELECT product, generation
         FROM cashmemo_schema_identity",
    )
    .fetch_optional(pool)
    .await?;

    match identity {
        Some((product, generation)) if product == "cashmemo" && generation == "v1" => {
            Ok(TargetState::CashmemoV1)
        }
        _ => Err(TargetError::UnknownNonEmpty),
    }
}
