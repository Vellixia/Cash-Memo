use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

use crate::{currency::CurrencyCode, transactions::Transaction};

#[derive(Clone)]
pub struct ReportingQueries {
    pool: PgPool,
}

#[derive(Debug, Error)]
pub enum ReportingError {
    #[error("report month is invalid")]
    InvalidMonth,
    #[error("report data is unavailable")]
    Persistence,
}

#[derive(Debug, Serialize)]
pub struct MonthlySummary {
    pub month: String,
    pub currencies: Vec<CurrencyMonthlySummary>,
}

#[derive(Debug, Serialize)]
pub struct CurrencyMonthlySummary {
    pub currency: CurrencyCode,
    pub income: String,
    pub expense: String,
    pub net: String,
    pub expense_categories: Vec<ExpenseCategorySummary>,
}

#[derive(Debug, Serialize)]
pub struct ExpenseCategorySummary {
    pub category_id: Uuid,
    pub name: String,
    pub expense: String,
}

#[derive(Debug, Serialize)]
pub struct RecentTransactions {
    pub items: Vec<Transaction>,
}

#[derive(FromRow)]
struct TotalsRow {
    currency_code: String,
    exponent: i32,
    income: Decimal,
    expense: Decimal,
}

#[derive(FromRow)]
struct CategoryRow {
    currency_code: String,
    category_id: Uuid,
    name: String,
    expense: Decimal,
    exponent: i32,
}

#[derive(FromRow)]
struct RecentRow {
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

impl ReportingQueries {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn monthly_summary(
        &self,
        user_id: Uuid,
        requested_month: Option<&str>,
    ) -> Result<MonthlySummary, ReportingError> {
        let timezone = user_timezone(&self.pool, user_id).await?;
        let month = requested_month
            .map(parse_month)
            .transpose()?
            .unwrap_or_else(|| current_month(timezone));
        let (start, end) = month_bounds(month, timezone)?;
        let totals: Vec<TotalsRow> = sqlx::query_as(
            "SELECT w.currency_code, c.exponent,
                    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'INCOME'), 0) AS income,
                    COALESCE(SUM(t.amount) FILTER (WHERE t.transaction_type = 'EXPENSE'), 0) AS expense
             FROM transactions t
             JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
             JOIN currencies c ON c.code = w.currency_code
             WHERE t.user_id = $1 AND t.deleted_at IS NULL
               AND t.occurred_at >= $2 AND t.occurred_at < $3 AND t.occurred_at <= now()
             GROUP BY w.currency_code, c.exponent
             ORDER BY w.currency_code",
        )
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| ReportingError::Persistence)?;
        let categories: Vec<CategoryRow> = sqlx::query_as(
            "SELECT w.currency_code, t.category_id, category.name, SUM(t.amount) AS expense, c.exponent
             FROM transactions t
             JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
             JOIN categories category ON (category.user_id, category.id) = (t.user_id, t.category_id)
             JOIN currencies c ON c.code = w.currency_code
             WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.transaction_type = 'EXPENSE'
               AND t.occurred_at >= $2 AND t.occurred_at < $3 AND t.occurred_at <= now()
             GROUP BY w.currency_code, t.category_id, category.name, category.normalized_name, c.exponent
             ORDER BY w.currency_code, expense DESC, category.normalized_name, t.category_id",
        )
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| ReportingError::Persistence)?;
        let mut by_currency: BTreeMap<String, Vec<ExpenseCategorySummary>> = BTreeMap::new();
        for row in categories {
            let exponent = exponent(row.exponent)?;
            by_currency
                .entry(row.currency_code)
                .or_default()
                .push(ExpenseCategorySummary {
                    category_id: row.category_id,
                    name: row.name,
                    expense: format_amount(row.expense, exponent),
                });
        }
        let currencies = totals
            .into_iter()
            .map(|row| {
                let exponent = exponent(row.exponent)?;
                let currency = CurrencyCode::parse(&row.currency_code)
                    .map_err(|_| ReportingError::Persistence)?;
                Ok(CurrencyMonthlySummary {
                    currency,
                    income: format_amount(row.income, exponent),
                    expense: format_amount(row.expense, exponent),
                    net: format_amount(row.income - row.expense, exponent),
                    expense_categories: by_currency.remove(&row.currency_code).unwrap_or_default(),
                })
            })
            .collect::<Result<_, ReportingError>>()?;
        Ok(MonthlySummary {
            month: format_month(month),
            currencies,
        })
    }

    pub async fn recent_transactions(
        &self,
        user_id: Uuid,
    ) -> Result<RecentTransactions, ReportingError> {
        let rows: Vec<RecentRow> = sqlx::query_as(
            "SELECT t.id, t.wallet_id, t.category_id, t.transaction_type::TEXT AS transaction_type,
                    t.amount, w.currency_code, c.exponent, t.occurred_at, t.note, t.deleted_at, t.purge_after
             FROM transactions t
             JOIN wallets w ON (w.user_id, w.id) = (t.user_id, t.wallet_id)
             JOIN currencies c ON c.code = w.currency_code
             WHERE t.user_id = $1 AND t.deleted_at IS NULL AND t.occurred_at <= now()
             ORDER BY t.occurred_at DESC, t.id DESC
             LIMIT 10",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| ReportingError::Persistence)?;
        let items = rows
            .into_iter()
            .map(Transaction::try_from)
            .collect::<Result<_, _>>()
            .map_err(|_| ReportingError::Persistence)?;
        Ok(RecentTransactions { items })
    }
}

async fn user_timezone(pool: &PgPool, user_id: Uuid) -> Result<Tz, ReportingError> {
    let timezone: Option<String> = sqlx::query_scalar("SELECT timezone FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| ReportingError::Persistence)?;
    timezone
        .ok_or(ReportingError::Persistence)?
        .parse()
        .map_err(|_| ReportingError::Persistence)
}

fn current_month(timezone: Tz) -> NaiveDate {
    let local = Utc::now().with_timezone(&timezone).date_naive();
    local.with_day(1).expect("day one exists")
}

fn parse_month(input: &str) -> Result<NaiveDate, ReportingError> {
    if input.len() != 7 || input.as_bytes().get(4) != Some(&b'-') {
        return Err(ReportingError::InvalidMonth);
    }
    let year = input[..4]
        .parse()
        .map_err(|_| ReportingError::InvalidMonth)?;
    let month = input[5..]
        .parse()
        .map_err(|_| ReportingError::InvalidMonth)?;
    NaiveDate::from_ymd_opt(year, month, 1).ok_or(ReportingError::InvalidMonth)
}

fn month_bounds(
    month: NaiveDate,
    timezone: Tz,
) -> Result<(DateTime<Utc>, DateTime<Utc>), ReportingError> {
    let next = if month.month() == 12 {
        NaiveDate::from_ymd_opt(month.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(month.year(), month.month() + 1, 1)
    }
    .ok_or(ReportingError::InvalidMonth)?;
    Ok((
        resolve_local_boundary(
            timezone,
            month
                .and_hms_opt(0, 0, 0)
                .ok_or(ReportingError::InvalidMonth)?,
        )?,
        resolve_local_boundary(
            timezone,
            next.and_hms_opt(0, 0, 0)
                .ok_or(ReportingError::InvalidMonth)?,
        )?,
    ))
}

fn resolve_local_boundary(
    timezone: Tz,
    requested: NaiveDateTime,
) -> Result<DateTime<Utc>, ReportingError> {
    match timezone.from_local_datetime(&requested) {
        LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
        LocalResult::Ambiguous(first, second) => Ok(first.min(second).with_timezone(&Utc)),
        LocalResult::None => resolve_nonexistent_local_boundary(timezone, requested),
    }
}

fn resolve_nonexistent_local_boundary(
    timezone: Tz,
    requested: NaiveDateTime,
) -> Result<DateTime<Utc>, ReportingError> {
    let mut missing_seconds = 0_i64;
    let mut valid_seconds = 1_i64;
    while matches!(
        timezone.from_local_datetime(&add_seconds(requested, valid_seconds)?),
        LocalResult::None
    ) {
        missing_seconds = valid_seconds;
        valid_seconds = valid_seconds
            .checked_mul(2)
            .filter(|seconds| *seconds <= 172_800)
            .ok_or(ReportingError::Persistence)?;
    }
    while valid_seconds - missing_seconds > 1 {
        let middle = missing_seconds + (valid_seconds - missing_seconds) / 2;
        if matches!(
            timezone.from_local_datetime(&add_seconds(requested, middle)?),
            LocalResult::None
        ) {
            missing_seconds = middle;
        } else {
            valid_seconds = middle;
        }
    }
    match timezone.from_local_datetime(&add_seconds(requested, valid_seconds)?) {
        LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
        LocalResult::Ambiguous(first, second) => Ok(first.min(second).with_timezone(&Utc)),
        LocalResult::None => Err(ReportingError::Persistence),
    }
}

fn add_seconds(value: NaiveDateTime, seconds: i64) -> Result<NaiveDateTime, ReportingError> {
    value
        .checked_add_signed(Duration::seconds(seconds))
        .ok_or(ReportingError::Persistence)
}

fn exponent(value: i32) -> Result<u32, ReportingError> {
    u32::try_from(value).map_err(|_| ReportingError::Persistence)
}

fn format_amount(amount: Decimal, exponent: u32) -> String {
    let mut amount = amount.round_dp(exponent);
    amount.rescale(exponent);
    amount.to_string()
}

fn format_month(month: NaiveDate) -> String {
    format!("{:04}-{:02}", month.year(), month.month())
}

impl TryFrom<RecentRow> for Transaction {
    type Error = ReportingError;

    fn try_from(row: RecentRow) -> Result<Self, Self::Error> {
        let exponent = exponent(row.exponent)?;
        let direction = match row.transaction_type.as_str() {
            "INCOME" => crate::transactions::TransactionDirection::Income,
            "EXPENSE" => crate::transactions::TransactionDirection::Expense,
            _ => return Err(ReportingError::Persistence),
        };
        Ok(Transaction {
            id: row.id,
            wallet_id: row.wallet_id,
            category_id: row.category_id,
            direction,
            amount: format_amount(row.amount, exponent),
            currency: CurrencyCode::parse(&row.currency_code)
                .map_err(|_| ReportingError::Persistence)?,
            occurred_at: row.occurred_at.to_rfc3339(),
            note: row.note,
            deleted_at: row.deleted_at.map(|value| value.to_rfc3339()),
            purge_after: row.purge_after.map(|value| value.to_rfc3339()),
        })
    }
}
