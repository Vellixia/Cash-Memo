use chrono::{Datelike, NaiveDate, Utc};
use chrono_tz::Tz;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    currency::{CurrencyCode, CurrencyRepository},
    money::{Money, format_exact_for_exponent, format_percentage_2dp},
    time::local_month_range,
};

#[derive(Clone)]
pub struct BudgetService {
    pool: PgPool,
}

#[derive(Debug, Error)]
pub enum BudgetError {
    #[error("budget or referenced category was not found")]
    NotFound,
    #[error("budget category is archived")]
    ArchivedCategory,
    #[error("budget month is invalid")]
    InvalidMonth,
    #[error("budget currency is invalid")]
    InvalidCurrency,
    #[error("budget amount is invalid")]
    InvalidAmount,
    #[error("budget update has no changes")]
    NoChanges,
    #[error("budget conflicts with an existing budget")]
    Conflict,
    #[error("budget persistence failed")]
    Persistence,
}

#[derive(Debug)]
pub struct NewBudget {
    pub category_id: Uuid,
    pub currency: String,
    pub month: String,
    pub amount: String,
}

#[derive(Debug)]
pub struct UpdateBudget {
    pub category_id: Option<Uuid>,
    pub currency: Option<String>,
    pub month: Option<String>,
    pub amount: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Budget {
    pub id: Uuid,
    pub category_id: Uuid,
    pub currency: CurrencyCode,
    pub month: String,
    pub amount: String,
}

#[derive(Debug, Serialize)]
pub struct BudgetSummary {
    pub month: String,
    pub budgets: Vec<BudgetProgress>,
}

#[derive(Debug, Serialize)]
pub struct BudgetProgress {
    pub id: Uuid,
    pub category_id: Uuid,
    pub currency: CurrencyCode,
    pub budgeted: String,
    pub spent: String,
    pub remaining: String,
    pub progress: String,
}

#[derive(FromRow)]
struct BudgetRow {
    id: Uuid,
    category_id: Uuid,
    currency_code: String,
    month_start: NaiveDate,
    amount: Decimal,
    exponent: i32,
}

#[derive(FromRow)]
struct SummaryRow {
    id: Uuid,
    category_id: Uuid,
    currency_code: String,
    amount: Decimal,
    spent: Decimal,
    exponent: i32,
}

impl BudgetService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(
        &self,
        user_id: Uuid,
        month: Option<&str>,
    ) -> Result<Vec<Budget>, BudgetError> {
        let month = month.map(parse_month).transpose()?;
        let rows: Vec<BudgetRow> = sqlx::query_as(
            "SELECT b.id, b.category_id, b.currency_code, b.month_start, b.amount, c.exponent
             FROM budgets b JOIN currencies c ON c.code = b.currency_code
             WHERE b.user_id = $1 AND ($2::date IS NULL OR b.month_start = $2)
             ORDER BY b.month_start, b.category_id, b.currency_code, b.id",
        )
        .bind(user_id)
        .bind(month)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| BudgetError::Persistence)?;
        rows.into_iter().map(Budget::try_from).collect()
    }

    pub async fn create(&self, user_id: Uuid, input: NewBudget) -> Result<Budget, BudgetError> {
        let month = parse_month(&input.month)?;
        let currency =
            CurrencyCode::parse(&input.currency).map_err(|_| BudgetError::InvalidCurrency)?;
        let definition = CurrencyRepository::require_enabled(&self.pool, &currency)
            .await
            .map_err(|_| BudgetError::InvalidCurrency)?;
        let amount = positive_amount(&input.amount, definition.exponent)?;
        require_active_expense_category(&self.pool, user_id, input.category_id).await?;
        let row: BudgetRow = sqlx::query_as(
            "INSERT INTO budgets (user_id, category_id, currency_code, month_start, amount)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, category_id, currency_code, month_start, amount,
                       (SELECT exponent FROM currencies WHERE code = currency_code) AS exponent",
        )
        .bind(user_id)
        .bind(input.category_id)
        .bind(currency.as_str())
        .bind(month)
        .bind(amount)
        .fetch_one(&self.pool)
        .await
        .map_err(map_database_error)?;
        row.try_into()
    }

    pub async fn update(
        &self,
        user_id: Uuid,
        budget_id: Uuid,
        input: UpdateBudget,
    ) -> Result<Budget, BudgetError> {
        if input.category_id.is_none()
            && input.currency.is_none()
            && input.month.is_none()
            && input.amount.is_none()
        {
            return Err(BudgetError::NoChanges);
        }
        let existing = load(&self.pool, user_id, budget_id).await?;
        let category_id = input.category_id.unwrap_or(existing.category_id);
        if input.category_id.is_some() {
            require_active_expense_category(&self.pool, user_id, category_id).await?;
        }
        let currency = match input.currency {
            Some(value) => CurrencyCode::parse(&value).map_err(|_| BudgetError::InvalidCurrency)?,
            None => CurrencyCode::parse(&existing.currency_code)
                .map_err(|_| BudgetError::Persistence)?,
        };
        let definition = CurrencyRepository::require_enabled(&self.pool, &currency)
            .await
            .map_err(|_| BudgetError::InvalidCurrency)?;
        let month = input
            .month
            .as_deref()
            .map(parse_month)
            .transpose()?
            .unwrap_or(existing.month_start);
        let amount = match input.amount {
            Some(value) => positive_amount(&value, definition.exponent)?,
            None => ensure_amount_exponent(existing.amount, definition.exponent)?,
        };
        let row: BudgetRow = sqlx::query_as(
            "UPDATE budgets SET category_id = $3, currency_code = $4, month_start = $5, amount = $6, updated_at = now()
             WHERE user_id = $1 AND id = $2
             RETURNING id, category_id, currency_code, month_start, amount,
                       (SELECT exponent FROM currencies WHERE code = currency_code) AS exponent",
        )
        .bind(user_id)
        .bind(budget_id)
        .bind(category_id)
        .bind(currency.as_str())
        .bind(month)
        .bind(amount)
        .fetch_one(&self.pool)
        .await
        .map_err(map_database_error)?;
        row.try_into()
    }

    pub async fn delete(&self, user_id: Uuid, budget_id: Uuid) -> Result<(), BudgetError> {
        let deleted = sqlx::query("DELETE FROM budgets WHERE user_id = $1 AND id = $2")
            .bind(user_id)
            .bind(budget_id)
            .execute(&self.pool)
            .await
            .map_err(|_| BudgetError::Persistence)?;
        if deleted.rows_affected() == 0 {
            return Err(BudgetError::NotFound);
        }
        Ok(())
    }

    pub async fn summary(&self, user_id: Uuid, month: &str) -> Result<BudgetSummary, BudgetError> {
        let month = parse_month(month)?;
        let timezone: String = sqlx::query_scalar("SELECT timezone FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| BudgetError::Persistence)?
            .ok_or(BudgetError::NotFound)?;
        let timezone: Tz = timezone.parse().map_err(|_| BudgetError::Persistence)?;
        let (start, end) =
            local_month_range(timezone, month).map_err(|_| BudgetError::Persistence)?;
        let rows: Vec<SummaryRow> = sqlx::query_as(
            "SELECT b.id, b.category_id, b.currency_code, b.amount, c.exponent,
                    COALESCE((
                        SELECT SUM(t.amount)
                        FROM transactions t
                        JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
                        WHERE t.user_id = b.user_id
                          AND t.category_id = b.category_id
                          AND t.transaction_type = 'EXPENSE'
                          AND t.deleted_at IS NULL
                          AND t.occurred_at <= now()
                          AND w.currency_code = b.currency_code
                          AND t.occurred_at >= $2 AND t.occurred_at < $3
                    ), 0) AS spent
             FROM budgets b
             JOIN currencies c ON c.code = b.currency_code
             WHERE b.user_id = $1 AND b.month_start = $4
             ORDER BY b.category_id, b.currency_code, b.id",
        )
        .bind(user_id)
        .bind(start)
        .bind(end)
        .bind(month)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| BudgetError::Persistence)?;
        let budgets = rows
            .into_iter()
            .map(BudgetProgress::try_from)
            .collect::<Result<_, _>>()?;
        Ok(BudgetSummary {
            month: format_month(month),
            budgets,
        })
    }

    pub async fn summary_for_month(
        &self,
        user_id: Uuid,
        requested_month: Option<&str>,
    ) -> Result<BudgetSummary, BudgetError> {
        let month = match requested_month {
            Some(month) => month.to_owned(),
            None => {
                let timezone: String =
                    sqlx::query_scalar("SELECT timezone FROM users WHERE id = $1")
                        .bind(user_id)
                        .fetch_optional(&self.pool)
                        .await
                        .map_err(|_| BudgetError::Persistence)?
                        .ok_or(BudgetError::NotFound)?;
                let timezone: Tz = timezone.parse().map_err(|_| BudgetError::Persistence)?;
                Utc::now()
                    .with_timezone(&timezone)
                    .format("%Y-%m")
                    .to_string()
            }
        };
        self.summary(user_id, &month).await
    }
}

async fn load(pool: &PgPool, user_id: Uuid, budget_id: Uuid) -> Result<BudgetRow, BudgetError> {
    sqlx::query_as(
        "SELECT b.id, b.category_id, b.currency_code, b.month_start, b.amount, c.exponent
         FROM budgets b JOIN currencies c ON c.code = b.currency_code
         WHERE b.user_id = $1 AND b.id = $2",
    )
    .bind(user_id)
    .bind(budget_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| BudgetError::Persistence)?
    .ok_or(BudgetError::NotFound)
}

async fn require_active_expense_category(
    pool: &PgPool,
    user_id: Uuid,
    category_id: Uuid,
) -> Result<(), BudgetError> {
    let row: Option<bool> = sqlx::query_scalar(
        "SELECT archived_at IS NOT NULL FROM categories
         WHERE user_id = $1 AND id = $2 AND transaction_type = 'EXPENSE'",
    )
    .bind(user_id)
    .bind(category_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| BudgetError::Persistence)?;
    match row {
        Some(false) => Ok(()),
        Some(true) => Err(BudgetError::ArchivedCategory),
        None => Err(BudgetError::NotFound),
    }
}

fn parse_month(input: &str) -> Result<NaiveDate, BudgetError> {
    if input.len() != 7 || input.as_bytes().get(4) != Some(&b'-') {
        return Err(BudgetError::InvalidMonth);
    }
    let year = input[..4]
        .parse::<i32>()
        .map_err(|_| BudgetError::InvalidMonth)?;
    let month = input[5..]
        .parse::<u32>()
        .map_err(|_| BudgetError::InvalidMonth)?;
    NaiveDate::from_ymd_opt(year, month, 1).ok_or(BudgetError::InvalidMonth)
}

fn positive_amount(input: &str, exponent: u32) -> Result<Decimal, BudgetError> {
    let amount = Money::parse_for_exponent(input, exponent)
        .map_err(|_| BudgetError::InvalidAmount)?
        .decimal();
    (amount > Decimal::ZERO)
        .then_some(amount)
        .ok_or(BudgetError::InvalidAmount)
}

fn ensure_amount_exponent(amount: Decimal, exponent: u32) -> Result<Decimal, BudgetError> {
    (amount > Decimal::ZERO && amount.normalize().scale() <= exponent)
        .then_some(amount)
        .ok_or(BudgetError::InvalidAmount)
}

fn format_amount(amount: Decimal, exponent: u32) -> Result<String, BudgetError> {
    format_exact_for_exponent(amount, exponent).map_err(|_| BudgetError::Persistence)
}

fn format_progress(spent: Decimal, budgeted: Decimal) -> String {
    format_percentage_2dp(spent * Decimal::ONE_HUNDRED / budgeted)
}

fn format_month(month: NaiveDate) -> String {
    format!("{:04}-{:02}", month.year(), month.month())
}

fn map_database_error(error: sqlx::Error) -> BudgetError {
    if let sqlx::Error::Database(database) = &error
        && database.code().as_deref() == Some("23505")
    {
        return BudgetError::Conflict;
    }
    BudgetError::Persistence
}

impl TryFrom<BudgetRow> for Budget {
    type Error = BudgetError;

    fn try_from(row: BudgetRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            category_id: row.category_id,
            currency: CurrencyCode::parse(&row.currency_code)
                .map_err(|_| BudgetError::Persistence)?,
            month: format_month(row.month_start),
            amount: format_amount(
                row.amount,
                u32::try_from(row.exponent).map_err(|_| BudgetError::Persistence)?,
            )?,
        })
    }
}

impl TryFrom<SummaryRow> for BudgetProgress {
    type Error = BudgetError;

    fn try_from(row: SummaryRow) -> Result<Self, Self::Error> {
        let exponent = u32::try_from(row.exponent).map_err(|_| BudgetError::Persistence)?;
        Ok(Self {
            id: row.id,
            category_id: row.category_id,
            currency: CurrencyCode::parse(&row.currency_code)
                .map_err(|_| BudgetError::Persistence)?,
            budgeted: format_amount(row.amount, exponent)?,
            spent: format_amount(row.spent, exponent)?,
            remaining: format_amount(row.amount - row.spent, exponent)?,
            progress: format_progress(row.spent, row.amount),
        })
    }
}
