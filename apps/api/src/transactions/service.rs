use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgConnection, PgPool};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    currency::CurrencyCode,
    money::Money,
    time::{UserTimezone, parse_local_minute, resolve_manual_local},
};

use super::query::{HistoryCursor, HistoryQuery};

#[derive(Clone)]
pub struct TransactionService {
    pool: PgPool,
}

#[derive(Debug, Error)]
pub enum TransactionError {
    #[error("transaction or referenced resource was not found")]
    NotFound,
    #[error("wallet is archived")]
    ArchivedWallet,
    #[error("category is archived")]
    ArchivedCategory,
    #[error("category kind does not match transaction direction")]
    CategoryKindMismatch,
    #[error("transaction direction is invalid")]
    InvalidDirection,
    #[error("transaction amount is invalid")]
    InvalidAmount,
    #[error("transaction note is invalid")]
    InvalidNote,
    #[error("transaction occurrence time is invalid")]
    InvalidOccurredAt,
    #[error("transaction update has no changes")]
    NoChanges,
    #[error("transaction history query is invalid")]
    InvalidHistoryQuery(&'static str),
    #[error("transaction persistence failed")]
    Persistence,
}

#[derive(Debug)]
pub struct NewTransaction {
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub direction: String,
    pub amount: String,
    pub note: Option<String>,
    pub occurred_local: Option<String>,
}

#[derive(Debug)]
pub struct UpdateTransaction {
    pub wallet_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub direction: Option<String>,
    pub amount: Option<String>,
    pub note: Option<Option<String>>,
    pub occurred_local: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Transaction {
    pub id: Uuid,
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub direction: TransactionDirection,
    pub amount: String,
    pub currency: CurrencyCode,
    pub occurred_at: String,
    pub note: Option<String>,
    pub deleted_at: Option<String>,
    pub purge_after: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EntryDefaults {
    pub last_used_wallet_id: Option<Uuid>,
    pub timezone: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TransactionDirection {
    Income,
    Expense,
}

impl TransactionDirection {
    pub(crate) fn parse(input: &str) -> Result<Self, TransactionError> {
        match input {
            "income" => Ok(Self::Income),
            "expense" => Ok(Self::Expense),
            _ => Err(TransactionError::InvalidDirection),
        }
    }

    pub(crate) fn database_value(self) -> &'static str {
        match self {
            Self::Income => "INCOME",
            Self::Expense => "EXPENSE",
        }
    }

    pub(crate) fn from_database(input: &str) -> Result<Self, TransactionError> {
        match input {
            "INCOME" => Ok(Self::Income),
            "EXPENSE" => Ok(Self::Expense),
            _ => Err(TransactionError::Persistence),
        }
    }
}

#[derive(FromRow)]
struct TransactionRow {
    id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    transaction_type: String,
    amount: Decimal,
    currency_code: String,
    exponent: i32,
    occurred_at: DateTime<Utc>,
    note: Option<String>,
    deleted_at: Option<DateTime<Utc>>,
    purge_after: Option<DateTime<Utc>>,
}

struct WalletScope {
    id: Uuid,
    exponent: u32,
}

impl TransactionService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        user_id: Uuid,
        input: NewTransaction,
    ) -> Result<Transaction, TransactionError> {
        let direction = TransactionDirection::parse(&input.direction)?;
        let note = validate_note(input.note)?;
        let mut database = self
            .pool
            .begin()
            .await
            .map_err(|_| TransactionError::Persistence)?;
        let occurred_at = match input.occurred_local {
            Some(value) => resolve_occurred_local(&mut database, user_id, &value).await?,
            None => Utc::now(),
        };
        let wallet = active_wallet(&mut database, user_id, input.wallet_id).await?;
        active_category(&mut database, user_id, input.category_id, direction).await?;
        let amount = parse_amount(&input.amount, wallet.exponent)?;
        let transaction_id: Uuid = sqlx::query_scalar(
            "INSERT INTO transactions
             (user_id, wallet_id, category_id, transaction_type, amount, occurred_at, note)
             VALUES ($1, $2, $3, $4::transaction_type, $5, $6, $7) RETURNING id",
        )
        .bind(user_id)
        .bind(wallet.id)
        .bind(input.category_id)
        .bind(direction.database_value())
        .bind(amount)
        .bind(occurred_at)
        .bind(note)
        .fetch_one(&mut *database)
        .await
        .map_err(|_| TransactionError::Persistence)?;
        database
            .commit()
            .await
            .map_err(|_| TransactionError::Persistence)?;
        self.get(user_id, transaction_id).await
    }

    pub async fn get(
        &self,
        user_id: Uuid,
        transaction_id: Uuid,
    ) -> Result<Transaction, TransactionError> {
        let row = load(&self.pool, user_id, transaction_id).await?;
        row.try_into()
    }

    pub async fn history(
        &self,
        user_id: Uuid,
        query: HistoryQuery,
        include_trash: bool,
    ) -> Result<HistoryPage, TransactionError> {
        let transaction_type = query
            .transaction_type
            .map(TransactionDirection::database_value);
        let cursor_occurred_at = query.cursor.as_ref().map(|cursor| cursor.occurred_at);
        let cursor_id = query.cursor.as_ref().map(|cursor| cursor.id);
        let mut rows: Vec<TransactionRow> = sqlx::query_as(history_query(include_trash))
            .bind(user_id)
            .bind(query.from)
            .bind(query.to)
            .bind(transaction_type)
            .bind(query.wallet_id)
            .bind(query.category_id)
            .bind(query.escaped_query)
            .bind(cursor_occurred_at)
            .bind(cursor_id)
            .bind(query.limit + 1)
            .fetch_all(&self.pool)
            .await
            .map_err(|_| TransactionError::Persistence)?;
        let has_more = rows.len() > query.limit as usize;
        rows.truncate(query.limit as usize);
        let next_cursor = has_more.then(|| {
            let last = rows.last().expect("non-empty page has cursor");
            HistoryCursor {
                occurred_at: last.occurred_at,
                id: last.id,
            }
            .encode()
        });
        let items = rows
            .into_iter()
            .map(Transaction::try_from)
            .collect::<Result<_, _>>()?;
        Ok(HistoryPage { items, next_cursor })
    }

    pub async fn update(
        &self,
        user_id: Uuid,
        transaction_id: Uuid,
        input: UpdateTransaction,
    ) -> Result<Transaction, TransactionError> {
        if input.wallet_id.is_none()
            && input.category_id.is_none()
            && input.direction.is_none()
            && input.amount.is_none()
            && input.note.is_none()
            && input.occurred_local.is_none()
        {
            return Err(TransactionError::NoChanges);
        }

        let mut database = self
            .pool
            .begin()
            .await
            .map_err(|_| TransactionError::Persistence)?;
        let previous = load_for_update(&mut database, user_id, transaction_id).await?;
        let previous_direction = TransactionDirection::from_database(&previous.transaction_type)?;
        let direction = input
            .direction
            .as_deref()
            .map(TransactionDirection::parse)
            .transpose()?
            .unwrap_or(previous_direction);
        let wallet_id = input.wallet_id.unwrap_or(previous.wallet_id);
        let category_id = input.category_id.unwrap_or(previous.category_id);

        let wallet = if input.wallet_id.is_some() {
            active_wallet(&mut database, user_id, wallet_id).await?
        } else {
            wallet_scope(&mut database, user_id, wallet_id).await?
        };
        if input.category_id.is_some() || input.direction.is_some() {
            active_category(&mut database, user_id, category_id, direction).await?;
        } else {
            owned_category(&mut database, user_id, category_id, direction).await?;
        }
        let amount = input
            .amount
            .as_deref()
            .map(|value| parse_amount(value, wallet.exponent))
            .transpose()?
            .unwrap_or(previous.amount);
        let note = match input.note {
            Some(value) => validate_note(value)?,
            None => previous.note,
        };
        let occurred_at = match input.occurred_local {
            Some(value) => resolve_occurred_local(&mut database, user_id, &value).await?,
            None => previous.occurred_at,
        };
        sqlx::query(
            "UPDATE transactions
             SET wallet_id = $3, category_id = $4, transaction_type = $5::transaction_type,
                 amount = $6, occurred_at = $7, note = $8, updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(transaction_id)
        .bind(wallet.id)
        .bind(category_id)
        .bind(direction.database_value())
        .bind(amount)
        .bind(occurred_at)
        .bind(note)
        .execute(&mut *database)
        .await
        .map_err(|_| TransactionError::Persistence)?;
        database
            .commit()
            .await
            .map_err(|_| TransactionError::Persistence)?;
        self.get(user_id, transaction_id).await
    }

    pub async fn trash(
        &self,
        user_id: Uuid,
        transaction_id: Uuid,
    ) -> Result<Transaction, TransactionError> {
        let updated = sqlx::query(
            "UPDATE transactions
             SET deleted_at = COALESCE(deleted_at, now()),
                 purge_after = COALESCE(purge_after, now() + INTERVAL '30 days'), updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(transaction_id)
        .execute(&self.pool)
        .await
        .map_err(|_| TransactionError::Persistence)?;
        if updated.rows_affected() == 0 {
            return Err(TransactionError::NotFound);
        }
        self.get(user_id, transaction_id).await
    }

    pub async fn restore(
        &self,
        user_id: Uuid,
        transaction_id: Uuid,
    ) -> Result<Transaction, TransactionError> {
        let updated = sqlx::query(
            "UPDATE transactions SET deleted_at = NULL, purge_after = NULL, updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(transaction_id)
        .execute(&self.pool)
        .await
        .map_err(|_| TransactionError::Persistence)?;
        if updated.rows_affected() == 0 {
            return Err(TransactionError::NotFound);
        }
        self.get(user_id, transaction_id).await
    }

    pub async fn permanently_delete(
        &self,
        user_id: Uuid,
        transaction_id: Uuid,
    ) -> Result<(), TransactionError> {
        let deleted = sqlx::query(
            "DELETE FROM transactions
             WHERE user_id = $1 AND id = $2
               AND deleted_at IS NOT NULL AND purge_after IS NOT NULL",
        )
        .bind(user_id)
        .bind(transaction_id)
        .execute(&self.pool)
        .await
        .map_err(|_| TransactionError::Persistence)?;
        if deleted.rows_affected() == 0 {
            return Err(TransactionError::NotFound);
        }
        Ok(())
    }

    pub async fn entry_defaults(&self, user_id: Uuid) -> Result<EntryDefaults, TransactionError> {
        let timezone: String = sqlx::query_scalar("SELECT timezone FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| TransactionError::Persistence)?
            .ok_or(TransactionError::NotFound)?;
        let last_used_wallet_id = sqlx::query_scalar(
            "SELECT t.wallet_id
             FROM transactions t
             JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
             WHERE t.user_id = $1 AND t.deleted_at IS NULL AND w.archived_at IS NULL
             ORDER BY t.created_at DESC, t.id DESC
             LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| TransactionError::Persistence)?;
        Ok(EntryDefaults {
            last_used_wallet_id,
            timezone,
        })
    }

    pub async fn purge_trash(&self, batch_size: i64) -> Result<u64, TransactionError> {
        if batch_size <= 0 {
            return Ok(0);
        }
        let deleted = sqlx::query(
            "DELETE FROM transactions
             WHERE id IN (
                SELECT id FROM transactions
                WHERE deleted_at IS NOT NULL AND purge_after <= now()
                ORDER BY purge_after, id
                LIMIT $1
                FOR UPDATE SKIP LOCKED
             )",
        )
        .bind(batch_size)
        .execute(&self.pool)
        .await
        .map_err(|_| TransactionError::Persistence)?;
        Ok(deleted.rows_affected())
    }
}

#[derive(Debug, Serialize)]
pub struct HistoryPage {
    pub items: Vec<Transaction>,
    pub next_cursor: Option<String>,
}

async fn active_wallet(
    database: &mut PgConnection,
    user_id: Uuid,
    wallet_id: Uuid,
) -> Result<WalletScope, TransactionError> {
    let archived: Option<bool> = sqlx::query_scalar(
        "SELECT archived_at IS NOT NULL FROM wallets WHERE user_id = $1 AND id = $2",
    )
    .bind(user_id)
    .bind(wallet_id)
    .fetch_optional(&mut *database)
    .await
    .map_err(|_| TransactionError::Persistence)?;
    match archived {
        None => Err(TransactionError::NotFound),
        Some(true) => Err(TransactionError::ArchivedWallet),
        Some(false) => wallet_scope(database, user_id, wallet_id).await,
    }
}

async fn wallet_scope(
    database: &mut PgConnection,
    user_id: Uuid,
    wallet_id: Uuid,
) -> Result<WalletScope, TransactionError> {
    let row: Option<(Uuid, i32)> = sqlx::query_as(
        "SELECT w.id, c.exponent
         FROM wallets w JOIN currencies c ON c.code = w.currency_code
         WHERE w.user_id = $1 AND w.id = $2",
    )
    .bind(user_id)
    .bind(wallet_id)
    .fetch_optional(&mut *database)
    .await
    .map_err(|_| TransactionError::Persistence)?;
    let (id, exponent) = row.ok_or(TransactionError::NotFound)?;
    Ok(WalletScope {
        id,
        exponent: u32::try_from(exponent).map_err(|_| TransactionError::Persistence)?,
    })
}

async fn active_category(
    database: &mut PgConnection,
    user_id: Uuid,
    category_id: Uuid,
    direction: TransactionDirection,
) -> Result<(), TransactionError> {
    let (category_direction, archived) = category_state(database, user_id, category_id).await?;
    if category_direction != direction {
        return Err(TransactionError::CategoryKindMismatch);
    }
    (!archived)
        .then_some(())
        .ok_or(TransactionError::ArchivedCategory)
}

async fn owned_category(
    database: &mut PgConnection,
    user_id: Uuid,
    category_id: Uuid,
    direction: TransactionDirection,
) -> Result<(), TransactionError> {
    let (category_direction, _) = category_state(database, user_id, category_id).await?;
    (category_direction == direction)
        .then_some(())
        .ok_or(TransactionError::CategoryKindMismatch)
}

async fn category_state(
    database: &mut PgConnection,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<(TransactionDirection, bool), TransactionError> {
    let row: Option<(String, bool)> = sqlx::query_as(
        "SELECT transaction_type::TEXT, archived_at IS NOT NULL FROM categories
         WHERE user_id = $1 AND id = $2",
    )
    .bind(user_id)
    .bind(category_id)
    .fetch_optional(&mut *database)
    .await
    .map_err(|_| TransactionError::Persistence)?;
    let (direction, archived) = row.ok_or(TransactionError::NotFound)?;
    Ok((TransactionDirection::from_database(&direction)?, archived))
}

async fn load(
    pool: &PgPool,
    user_id: Uuid,
    transaction_id: Uuid,
) -> Result<TransactionRow, TransactionError> {
    sqlx::query_as(&transaction_query("WHERE t.user_id = $1 AND t.id = $2"))
        .bind(user_id)
        .bind(transaction_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| TransactionError::Persistence)?
        .ok_or(TransactionError::NotFound)
}

async fn load_for_update(
    database: &mut PgConnection,
    user_id: Uuid,
    transaction_id: Uuid,
) -> Result<TransactionRow, TransactionError> {
    sqlx::query_as(&format!(
        "{} FOR UPDATE",
        transaction_query("WHERE t.user_id = $1 AND t.id = $2")
    ))
    .bind(user_id)
    .bind(transaction_id)
    .fetch_optional(&mut *database)
    .await
    .map_err(|_| TransactionError::Persistence)?
    .ok_or(TransactionError::NotFound)
}

fn transaction_query(filter: &str) -> String {
    format!(
        "SELECT t.id, t.wallet_id, t.category_id, t.transaction_type::TEXT AS transaction_type,
                t.amount, w.currency_code, c.exponent, t.occurred_at, t.note, t.deleted_at, t.purge_after
         FROM transactions t
         JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
         JOIN currencies c ON c.code = w.currency_code
         {filter}"
    )
}

fn history_query(include_trash: bool) -> &'static str {
    if include_trash {
        "SELECT t.id, t.wallet_id, t.category_id, t.transaction_type::TEXT AS transaction_type,
                t.amount, w.currency_code, c.exponent, t.occurred_at, t.note, t.deleted_at, t.purge_after
         FROM transactions t
         JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
         JOIN categories category ON (category.user_id, category.id) = (t.user_id, t.category_id)
         JOIN currencies c ON c.code = w.currency_code
         WHERE t.user_id = $1 AND t.deleted_at IS NOT NULL
           AND ($2::TIMESTAMPTZ IS NULL OR t.occurred_at >= $2)
           AND ($3::TIMESTAMPTZ IS NULL OR t.occurred_at <= $3)
           AND ($4::TEXT IS NULL OR t.transaction_type::TEXT = $4)
           AND ($5::UUID IS NULL OR t.wallet_id = $5)
           AND ($6::UUID IS NULL OR t.category_id = $6)
           AND ($7::TEXT IS NULL OR t.note ILIKE '%' || $7 || '%' ESCAPE '\\'
                OR w.name ILIKE '%' || $7 || '%' ESCAPE '\\'
                OR category.name ILIKE '%' || $7 || '%' ESCAPE '\\')
           AND ($8::TIMESTAMPTZ IS NULL OR (t.occurred_at, t.id) < ($8, $9::UUID))
         ORDER BY t.occurred_at DESC, t.id DESC
         LIMIT $10"
    } else {
        "SELECT t.id, t.wallet_id, t.category_id, t.transaction_type::TEXT AS transaction_type,
                t.amount, w.currency_code, c.exponent, t.occurred_at, t.note, t.deleted_at, t.purge_after
         FROM transactions t
         JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
         JOIN categories category ON (category.user_id, category.id) = (t.user_id, t.category_id)
         JOIN currencies c ON c.code = w.currency_code
         WHERE t.user_id = $1 AND t.deleted_at IS NULL
           AND ($2::TIMESTAMPTZ IS NULL OR t.occurred_at >= $2)
           AND ($3::TIMESTAMPTZ IS NULL OR t.occurred_at <= $3)
           AND ($4::TEXT IS NULL OR t.transaction_type::TEXT = $4)
           AND ($5::UUID IS NULL OR t.wallet_id = $5)
           AND ($6::UUID IS NULL OR t.category_id = $6)
           AND ($7::TEXT IS NULL OR t.note ILIKE '%' || $7 || '%' ESCAPE '\\'
                OR w.name ILIKE '%' || $7 || '%' ESCAPE '\\'
                OR category.name ILIKE '%' || $7 || '%' ESCAPE '\\')
           AND ($8::TIMESTAMPTZ IS NULL OR (t.occurred_at, t.id) < ($8, $9::UUID))
         ORDER BY t.occurred_at DESC, t.id DESC
         LIMIT $10"
    }
}

impl TryFrom<TransactionRow> for Transaction {
    type Error = TransactionError;

    fn try_from(row: TransactionRow) -> Result<Self, Self::Error> {
        let exponent = u32::try_from(row.exponent).map_err(|_| TransactionError::Persistence)?;
        Ok(Self {
            id: row.id,
            wallet_id: row.wallet_id,
            category_id: row.category_id,
            direction: TransactionDirection::from_database(&row.transaction_type)?,
            amount: format_amount(row.amount, exponent),
            currency: CurrencyCode::parse(&row.currency_code)
                .map_err(|_| TransactionError::Persistence)?,
            occurred_at: row.occurred_at.to_rfc3339(),
            note: row.note,
            deleted_at: row.deleted_at.map(|value| value.to_rfc3339()),
            purge_after: row.purge_after.map(|value| value.to_rfc3339()),
        })
    }
}

fn parse_amount(input: &str, exponent: u32) -> Result<Decimal, TransactionError> {
    let amount =
        Money::parse_for_exponent(input, exponent).map_err(|_| TransactionError::InvalidAmount)?;
    (amount.decimal() > Decimal::ZERO)
        .then_some(amount.decimal())
        .ok_or(TransactionError::InvalidAmount)
}

fn validate_note(input: Option<String>) -> Result<Option<String>, TransactionError> {
    match input {
        Some(value) if value.chars().count() > 500 => Err(TransactionError::InvalidNote),
        value => Ok(value),
    }
}

async fn resolve_occurred_local(
    database: &mut PgConnection,
    user_id: Uuid,
    input: &str,
) -> Result<DateTime<Utc>, TransactionError> {
    let timezone: String = sqlx::query_scalar("SELECT timezone FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&mut *database)
        .await
        .map_err(|_| TransactionError::Persistence)?
        .ok_or(TransactionError::NotFound)?;
    let timezone = UserTimezone::parse(&timezone).map_err(|_| TransactionError::Persistence)?;
    let local = parse_local_minute(input).map_err(|_| TransactionError::InvalidOccurredAt)?;
    resolve_manual_local(timezone.timezone(), local)
        .map_err(|_| TransactionError::InvalidOccurredAt)
}

fn format_amount(amount: Decimal, exponent: u32) -> String {
    let mut rendered = amount.normalize().to_string();
    if exponent == 0 {
        return rendered.split('.').next().unwrap_or(&rendered).to_owned();
    }
    let fractional_length = rendered
        .split_once('.')
        .map_or(0, |(_, fractional)| fractional.len());
    if fractional_length == 0 {
        rendered.push('.');
    }
    if fractional_length < exponent as usize {
        rendered.push_str(&"0".repeat(exponent as usize - fractional_length));
    }
    rendered
}
