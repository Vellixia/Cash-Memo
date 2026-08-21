use sqlx::PgPool;
use thiserror::Error;

const MIGRATIONS_TABLE: &str = "_sqlx_migrations";
const IDENTITY_ONLY_TABLES: &[&str] = &[MIGRATIONS_TABLE, "cashmemo_schema_identity"];
const V1_TABLES: &[&str] = &[
    MIGRATIONS_TABLE,
    "auth_tokens",
    "budgets",
    "cashmemo_schema_identity",
    "categories",
    "currencies",
    "recurring_occurrences",
    "recurring_transactions",
    "sessions",
    "transactions",
    "users",
    "wallets",
];
const IDENTITY_ONLY_MIGRATIONS: &[(i64, bool)] = &[(1, true)];
const FULL_V1_MIGRATIONS: &[(i64, bool)] = &[(1, true), (2, true), (3, true), (4, true), (5, true)];

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

    let table_names = tables.iter().map(String::as_str).collect::<Vec<_>>();
    let expected_migrations = if table_names == IDENTITY_ONLY_TABLES {
        IDENTITY_ONLY_MIGRATIONS
    } else if table_names == V1_TABLES {
        FULL_V1_MIGRATIONS
    } else {
        return Err(TargetError::UnknownNonEmpty);
    };

    let identity: Option<(String, String)> = sqlx::query_as(
        "SELECT product, generation
         FROM cashmemo_schema_identity",
    )
    .fetch_optional(pool)
    .await?;

    if !matches!(identity, Some((product, generation)) if product == "cashmemo" && generation == "v1")
    {
        return Err(TargetError::UnknownNonEmpty);
    }

    let migrations: Vec<(i64, bool)> =
        sqlx::query_as("SELECT version, success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await?;
    if migrations.as_slice() != expected_migrations {
        return Err(TargetError::UnknownNonEmpty);
    }

    Ok(TargetState::CashmemoV1)
}
