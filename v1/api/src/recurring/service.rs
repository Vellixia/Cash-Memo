use chrono::{Datelike, NaiveDate, Utc};
use chrono_tz::Tz;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgConnection, PgPool};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{currency::CurrencyCode, money::Money, transactions::TransactionDirection};

#[derive(Clone)]
pub struct RecurringTransactionService {
    pool: PgPool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Cadence {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Cadence {
    pub fn parse(value: &str) -> Result<Self, RecurringError> {
        match value {
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            "monthly" => Ok(Self::Monthly),
            "yearly" => Ok(Self::Yearly),
            _ => Err(RecurringError::InvalidFrequency),
        }
    }

    pub(crate) fn database_value(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
            Self::Monthly => "monthly",
            Self::Yearly => "yearly",
        }
    }

    pub(crate) fn from_database(value: &str) -> Result<Self, RecurringError> {
        Self::parse(value).map_err(|_| RecurringError::Persistence)
    }
}

#[derive(Debug, Error)]
pub enum RecurringError {
    #[error("recurring transaction or referenced resource was not found")]
    NotFound,
    #[error("recurring transaction wallet is archived")]
    ArchivedWallet,
    #[error("recurring transaction category is archived")]
    ArchivedCategory,
    #[error("recurring transaction category kind does not match direction")]
    CategoryKindMismatch,
    #[error("recurring transaction direction is invalid")]
    InvalidDirection,
    #[error("recurring transaction amount is invalid")]
    InvalidAmount,
    #[error("recurring transaction note is invalid")]
    InvalidNote,
    #[error("recurring transaction frequency is invalid")]
    InvalidFrequency,
    #[error("recurring transaction start date is invalid")]
    InvalidStartDate,
    #[error("recurring transaction update has no changes")]
    NoChanges,
    #[error("recurring transaction persistence failed")]
    Persistence,
}

#[derive(Debug)]
pub struct NewRecurringTransaction {
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub direction: String,
    pub amount: String,
    pub note: Option<String>,
    pub frequency: String,
    pub start_date: String,
}

#[derive(Debug)]
pub struct UpdateRecurringTransaction {
    pub wallet_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub direction: Option<String>,
    pub amount: Option<String>,
    pub note: Option<Option<String>>,
    pub frequency: Option<String>,
    pub start_date: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecurringTransaction {
    pub id: Uuid,
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub direction: TransactionDirection,
    pub amount: String,
    pub currency: CurrencyCode,
    pub note: Option<String>,
    pub frequency: Cadence,
    pub start_date: String,
    pub next_due_date: String,
    pub status: RecurringStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RecurringStatus {
    Active,
    Paused,
}

impl RecurringStatus {
    fn from_database(value: &str) -> Result<Self, RecurringError> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            _ => Err(RecurringError::Persistence),
        }
    }
}

#[derive(FromRow)]
struct RecurringRow {
    id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    transaction_type: String,
    amount: Decimal,
    currency_code: String,
    exponent: i32,
    note: Option<String>,
    frequency: String,
    start_date: NaiveDate,
    next_due_date: NaiveDate,
    status: String,
}

impl RecurringTransactionService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        user_id: Uuid,
        input: NewRecurringTransaction,
    ) -> Result<RecurringTransaction, RecurringError> {
        let direction =
            TransactionDirection::parse(&input.direction).map_err(map_transaction_error)?;
        let cadence = Cadence::parse(&input.frequency)?;
        let start_date = parse_date(&input.start_date)?;
        let note = validate_note(input.note)?;
        let mut database = self
            .pool
            .begin()
            .await
            .map_err(|_| RecurringError::Persistence)?;
        let (timezone, wallet_exponent) = active_references(
            &mut database,
            user_id,
            input.wallet_id,
            input.category_id,
            direction,
        )
        .await?;
        let amount = parse_amount(&input.amount, wallet_exponent)?;
        let today = local_today(&timezone)?;
        let next_due_date = first_due_on_or_after(start_date, today, cadence);
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO recurring_transactions
             (user_id, wallet_id, category_id, transaction_type, amount, note, frequency, start_date, next_due_date)
             VALUES ($1, $2, $3, $4::transaction_type, $5, $6, $7::recurrence_frequency, $8, $9)
             RETURNING id",
        )
        .bind(user_id)
        .bind(input.wallet_id)
        .bind(input.category_id)
        .bind(direction.database_value())
        .bind(amount)
        .bind(note)
        .bind(cadence.database_value())
        .bind(start_date)
        .bind(next_due_date)
        .fetch_one(&mut *database)
        .await
        .map_err(|_| RecurringError::Persistence)?;
        database
            .commit()
            .await
            .map_err(|_| RecurringError::Persistence)?;
        self.get(user_id, id).await
    }

    pub async fn list(&self, user_id: Uuid) -> Result<Vec<RecurringTransaction>, RecurringError> {
        sqlx::query_as::<_, RecurringRow>(&format!(
            "{} WHERE r.user_id = $1 ORDER BY r.created_at, r.id",
            recurring_query()
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| RecurringError::Persistence)?
        .into_iter()
        .map(TryInto::try_into)
        .collect()
    }

    pub async fn get(
        &self,
        user_id: Uuid,
        id: Uuid,
    ) -> Result<RecurringTransaction, RecurringError> {
        load(&self.pool, user_id, id).await?.try_into()
    }

    pub async fn pause(
        &self,
        user_id: Uuid,
        id: Uuid,
    ) -> Result<RecurringTransaction, RecurringError> {
        let changed = sqlx::query(
            "UPDATE recurring_transactions SET status = 'paused', updated_at = now()
             WHERE user_id = $1 AND id = $2 AND status = 'active'",
        )
        .bind(user_id)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|_| RecurringError::Persistence)?;
        if changed.rows_affected() == 0 {
            self.get(user_id, id).await?;
        }
        self.get(user_id, id).await
    }

    pub async fn update(
        &self,
        user_id: Uuid,
        id: Uuid,
        input: UpdateRecurringTransaction,
    ) -> Result<RecurringTransaction, RecurringError> {
        if input.wallet_id.is_none()
            && input.category_id.is_none()
            && input.direction.is_none()
            && input.amount.is_none()
            && input.note.is_none()
            && input.frequency.is_none()
            && input.start_date.is_none()
        {
            return Err(RecurringError::NoChanges);
        }
        let mut db = self
            .pool
            .begin()
            .await
            .map_err(|_| RecurringError::Persistence)?;
        let row = load_for_update(&mut db, user_id, id).await?;
        let wallet_id = input.wallet_id.unwrap_or(row.wallet_id);
        let category_id = input.category_id.unwrap_or(row.category_id);
        let direction = input
            .direction
            .as_deref()
            .map(TransactionDirection::parse)
            .transpose()
            .map_err(map_transaction_error)?
            .unwrap_or(
                TransactionDirection::from_database(&row.transaction_type)
                    .map_err(map_transaction_error)?,
            );
        let cadence = input
            .frequency
            .as_deref()
            .map(Cadence::parse)
            .transpose()?
            .unwrap_or(Cadence::from_database(&row.frequency)?);
        let start_date = input
            .start_date
            .as_deref()
            .map(parse_date)
            .transpose()?
            .unwrap_or(row.start_date);
        let note = match input.note {
            Some(value) => validate_note(value)?,
            None => row.note,
        };
        let (timezone, exponent) =
            active_references(&mut db, user_id, wallet_id, category_id, direction).await?;
        let amount = input
            .amount
            .as_deref()
            .map(|value| parse_amount(value, exponent))
            .transpose()?
            .unwrap_or(row.amount);
        let due = if input.frequency.is_some() || input.start_date.is_some() {
            first_due_on_or_after(start_date, local_today(&timezone)?, cadence)
        } else {
            row.next_due_date
        };
        sqlx::query("UPDATE recurring_transactions SET wallet_id=$3,category_id=$4,transaction_type=$5::transaction_type,amount=$6,note=$7,frequency=$8::recurrence_frequency,start_date=$9,next_due_date=$10,updated_at=now() WHERE user_id=$1 AND id=$2")
            .bind(user_id).bind(id).bind(wallet_id).bind(category_id).bind(direction.database_value()).bind(amount).bind(note).bind(cadence.database_value()).bind(start_date).bind(due).execute(&mut *db).await.map_err(|_| RecurringError::Persistence)?;
        db.commit().await.map_err(|_| RecurringError::Persistence)?;
        self.get(user_id, id).await
    }

    pub async fn resume(
        &self,
        user_id: Uuid,
        id: Uuid,
    ) -> Result<RecurringTransaction, RecurringError> {
        let mut database = self
            .pool
            .begin()
            .await
            .map_err(|_| RecurringError::Persistence)?;
        let row = load_for_update(&mut database, user_id, id).await?;
        let direction = TransactionDirection::from_database(&row.transaction_type)
            .map_err(map_transaction_error)?;
        let (timezone, _) = active_references(
            &mut database,
            user_id,
            row.wallet_id,
            row.category_id,
            direction,
        )
        .await?;
        let cadence = Cadence::from_database(&row.frequency)?;
        let next_due_date =
            first_due_on_or_after(row.next_due_date, local_today(&timezone)?, cadence);
        sqlx::query(
            "UPDATE recurring_transactions
             SET status = 'active', next_due_date = $3, updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(id)
        .bind(next_due_date)
        .execute(&mut *database)
        .await
        .map_err(|_| RecurringError::Persistence)?;
        database
            .commit()
            .await
            .map_err(|_| RecurringError::Persistence)?;
        self.get(user_id, id).await
    }
}

pub fn first_due_on_or_after(start: NaiveDate, today: NaiveDate, cadence: Cadence) -> NaiveDate {
    let mut due = start;
    while due < today {
        due = next_due(due, start.day(), cadence);
    }
    due
}

pub fn next_due(after: NaiveDate, anchor_day: u32, cadence: Cadence) -> NaiveDate {
    match cadence {
        Cadence::Daily => after.succ_opt().expect("valid date has successor"),
        Cadence::Weekly => after
            .checked_add_days(chrono::Days::new(7))
            .expect("valid date has successor"),
        Cadence::Monthly => shifted_date(after.year(), after.month() + 1, anchor_day),
        Cadence::Yearly => clamped_date(after.year() + 1, after.month(), anchor_day),
    }
}

fn shifted_date(year: i32, month_after: u32, day: u32) -> NaiveDate {
    let year = year + i32::try_from((month_after - 1) / 12).expect("month delta fits i32");
    let month = (month_after - 1) % 12 + 1;
    clamped_date(year, month, day)
}

fn clamped_date(year: i32, month: u32, day: u32) -> NaiveDate {
    let mut candidate = day;
    loop {
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, candidate) {
            return date;
        }
        candidate -= 1;
    }
}

async fn active_references(
    database: &mut PgConnection,
    user_id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    direction: TransactionDirection,
) -> Result<(String, u32), RecurringError> {
    let wallet: Option<(String, i32, bool)> = sqlx::query_as(
        "SELECT u.timezone, currency.exponent, w.archived_at IS NOT NULL
         FROM wallets w
         JOIN users u ON u.id = w.user_id
         JOIN currencies currency ON currency.code = w.currency_code
         WHERE w.user_id = $1 AND w.id = $2 FOR UPDATE",
    )
    .bind(user_id)
    .bind(wallet_id)
    .fetch_optional(&mut *database)
    .await
    .map_err(|_| RecurringError::Persistence)?;
    let (timezone, exponent, archived) = wallet.ok_or(RecurringError::NotFound)?;
    if archived {
        return Err(RecurringError::ArchivedWallet);
    }
    let category: Option<(String, bool)> = sqlx::query_as(
        "SELECT transaction_type::TEXT, archived_at IS NOT NULL
         FROM categories WHERE user_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(user_id)
    .bind(category_id)
    .fetch_optional(&mut *database)
    .await
    .map_err(|_| RecurringError::Persistence)?;
    let (kind, archived) = category.ok_or(RecurringError::NotFound)?;
    if archived {
        return Err(RecurringError::ArchivedCategory);
    }
    if TransactionDirection::from_database(&kind).map_err(map_transaction_error)? != direction {
        return Err(RecurringError::CategoryKindMismatch);
    }
    Ok((
        timezone,
        u32::try_from(exponent).map_err(|_| RecurringError::Persistence)?,
    ))
}

fn local_today(timezone: &str) -> Result<NaiveDate, RecurringError> {
    let timezone: Tz = timezone.parse().map_err(|_| RecurringError::Persistence)?;
    Ok(Utc::now().with_timezone(&timezone).date_naive())
}

async fn load(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<RecurringRow, RecurringError> {
    sqlx::query_as(&format!(
        "{} WHERE r.user_id = $1 AND r.id = $2",
        recurring_query()
    ))
    .bind(user_id)
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|_| RecurringError::Persistence)?
    .ok_or(RecurringError::NotFound)
}

async fn load_for_update(
    database: &mut PgConnection,
    user_id: Uuid,
    id: Uuid,
) -> Result<RecurringRow, RecurringError> {
    sqlx::query_as(&format!(
        "{} WHERE r.user_id = $1 AND r.id = $2 FOR UPDATE",
        recurring_query()
    ))
    .bind(user_id)
    .bind(id)
    .fetch_optional(&mut *database)
    .await
    .map_err(|_| RecurringError::Persistence)?
    .ok_or(RecurringError::NotFound)
}

fn recurring_query() -> &'static str {
    "SELECT r.id, r.wallet_id, r.category_id, r.transaction_type::TEXT AS transaction_type,
            r.amount, w.currency_code, currency.exponent, r.note, r.frequency::TEXT AS frequency,
            r.start_date, r.next_due_date, r.status::TEXT AS status
     FROM recurring_transactions r
     JOIN wallets w ON (w.user_id, w.id) = (r.user_id, r.wallet_id)
     JOIN currencies currency ON currency.code = w.currency_code"
}

impl TryFrom<RecurringRow> for RecurringTransaction {
    type Error = RecurringError;

    fn try_from(row: RecurringRow) -> Result<Self, Self::Error> {
        let exponent = u32::try_from(row.exponent).map_err(|_| RecurringError::Persistence)?;
        Ok(Self {
            id: row.id,
            wallet_id: row.wallet_id,
            category_id: row.category_id,
            direction: TransactionDirection::from_database(&row.transaction_type)
                .map_err(map_transaction_error)?,
            amount: format_amount(row.amount, exponent),
            currency: CurrencyCode::parse(&row.currency_code)
                .map_err(|_| RecurringError::Persistence)?,
            note: row.note,
            frequency: Cadence::from_database(&row.frequency)?,
            start_date: row.start_date.to_string(),
            next_due_date: row.next_due_date.to_string(),
            status: RecurringStatus::from_database(&row.status)?,
        })
    }
}

fn parse_date(value: &str) -> Result<NaiveDate, RecurringError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| RecurringError::InvalidStartDate)
}

fn parse_amount(value: &str, exponent: u32) -> Result<Decimal, RecurringError> {
    let amount =
        Money::parse_for_exponent(value, exponent).map_err(|_| RecurringError::InvalidAmount)?;
    (amount.decimal() > Decimal::ZERO)
        .then_some(amount.decimal())
        .ok_or(RecurringError::InvalidAmount)
}

fn validate_note(value: Option<String>) -> Result<Option<String>, RecurringError> {
    match value {
        Some(note) if note.chars().count() > 500 => Err(RecurringError::InvalidNote),
        other => Ok(other),
    }
}

fn format_amount(amount: Decimal, exponent: u32) -> String {
    let mut rendered = amount.normalize().to_string();
    if exponent == 0 {
        return rendered.split('.').next().unwrap_or(&rendered).to_owned();
    }
    let fractional = rendered.split_once('.').map_or(0, |(_, value)| value.len());
    if fractional == 0 {
        rendered.push('.');
    }
    if fractional < exponent as usize {
        rendered.push_str(&"0".repeat(exponent as usize - fractional));
    }
    rendered
}

fn map_transaction_error(error: crate::transactions::TransactionError) -> RecurringError {
    match error {
        crate::transactions::TransactionError::InvalidDirection => RecurringError::InvalidDirection,
        _ => RecurringError::Persistence,
    }
}
