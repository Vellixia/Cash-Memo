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
const FULL_V1_MIGRATIONS: &[(i64, bool)] = &[
    (1, true),
    (2, true),
    (3, true),
    (4, true),
    (5, true),
    (6, true),
    (7, true),
    (8, true),
    (9, true),
];
const PRE_WALLET_ONBOARDING_REPAIR_MIGRATIONS: &[(i64, bool)] = &[
    (1, true),
    (2, true),
    (3, true),
    (4, true),
    (5, true),
    (6, true),
    (7, true),
    (8, true),
];
const PRE_ACCOUNT_DELETION_MIGRATIONS: &[(i64, bool)] = &[
    (1, true),
    (2, true),
    (3, true),
    (4, true),
    (5, true),
    (6, true),
    (7, true),
];
const PRE_RECURRING_CONSTRAINTS_MIGRATIONS: &[(i64, bool)] = &[
    (1, true),
    (2, true),
    (3, true),
    (4, true),
    (5, true),
    (6, true),
];
const PRE_HISTORY_MIGRATIONS: &[(i64, bool)] =
    &[(1, true), (2, true), (3, true), (4, true), (5, true)];
const FULL_SCHEMA_MIGRATION_PREFIXES: &[&[(i64, bool)]] = &[
    &[(1, true), (2, true)],
    &[(1, true), (2, true), (3, true)],
    &[(1, true), (2, true), (3, true), (4, true)],
    PRE_HISTORY_MIGRATIONS,
    PRE_RECURRING_CONSTRAINTS_MIGRATIONS,
    PRE_ACCOUNT_DELETION_MIGRATIONS,
    PRE_WALLET_ONBOARDING_REPAIR_MIGRATIONS,
    FULL_V1_MIGRATIONS,
];

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
    let expected_migration_prefixes = if table_names == IDENTITY_ONLY_TABLES {
        &[IDENTITY_ONLY_MIGRATIONS][..]
    } else if table_names == V1_TABLES {
        FULL_SCHEMA_MIGRATION_PREFIXES
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

    let migrations: Vec<(i64, bool, Vec<u8>)> =
        sqlx::query_as("SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await?;
    let migrations_are_valid = expected_migration_prefixes
        .iter()
        .any(|prefix| migrations_match(&migrations, prefix));
    if !migrations_are_valid {
        return Err(TargetError::UnknownNonEmpty);
    }

    Ok(TargetState::CashmemoV1)
}

pub async fn assert_latest_v1_migration_target(pool: &PgPool) -> Result<TargetState, TargetError> {
    let state = assert_v1_migration_target(pool).await?;
    let migrations: Vec<(i64, bool, Vec<u8>)> =
        sqlx::query_as("SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await?;
    if migrations_match(&migrations, FULL_V1_MIGRATIONS) {
        Ok(state)
    } else {
        Err(TargetError::UnknownNonEmpty)
    }
}

fn migrations_match(actual: &[(i64, bool, Vec<u8>)], expected: &[(i64, bool)]) -> bool {
    let known = sqlx::migrate!("./migrations");
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|((version, success, checksum), expected)| {
                let Some(migration) = known.iter().find(|migration| migration.version == *version)
                else {
                    return false;
                };
                (*version, *success) == *expected
                    && checksum.as_slice() == migration.checksum.as_ref()
            })
}
