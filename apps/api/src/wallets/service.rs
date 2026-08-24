use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    currency::{CurrencyCode, CurrencyError, CurrencyRepository},
    money::Money,
};

#[derive(Clone)]
pub struct WalletService {
    pool: PgPool,
}

#[derive(Debug, Error)]
pub enum WalletError {
    #[error("wallet was not found")]
    NotFound,
    #[error("wallet has references")]
    HasReferences,
    #[error("wallet name is invalid")]
    InvalidName,
    #[error("wallet currency is invalid")]
    InvalidCurrency,
    #[error("wallet currency is unsupported")]
    UnsupportedCurrency,
    #[error("wallet opening balance is invalid")]
    InvalidOpeningBalance,
    #[error("wallet update has no changes")]
    NoChanges,
    #[error("wallet persistence failed")]
    Persistence,
}

#[derive(Debug)]
pub struct NewWallet {
    pub name: String,
    pub currency: String,
    pub opening_balance: String,
}

#[derive(Debug)]
pub struct UpdateWallet {
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WalletBalance {
    pub currency: CurrencyCode,
    pub amount: String,
    pub as_of: String,
}

#[derive(Debug, Serialize)]
pub struct Wallet {
    pub id: Uuid,
    pub name: String,
    pub currency: CurrencyCode,
    pub opening_balance: String,
    pub archived_at: Option<String>,
    pub balance: WalletBalance,
}

#[derive(Debug, Serialize)]
pub struct ArchiveResult {
    #[serde(flatten)]
    pub wallet: Wallet,
    pub paused_recurring_count: u64,
}

#[derive(FromRow)]
struct WalletRow {
    id: Uuid,
    name: String,
    currency_code: String,
    exponent: i32,
    opening_balance: Decimal,
    archived_at: Option<DateTime<Utc>>,
    balance: Decimal,
    as_of: DateTime<Utc>,
}

impl WalletService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self, user_id: Uuid) -> Result<Vec<Wallet>, WalletError> {
        let rows = sqlx::query_as::<_, WalletRow>(&format!(
            "{} ORDER BY w.archived_at NULLS FIRST, lower(w.name), w.id",
            wallet_query("WHERE w.user_id = $1")
        ))
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| WalletError::Persistence)?;
        rows.into_iter().map(Wallet::try_from).collect()
    }

    pub async fn get(&self, user_id: Uuid, wallet_id: Uuid) -> Result<Wallet, WalletError> {
        self.load(user_id, wallet_id).await
    }

    pub async fn create(&self, user_id: Uuid, input: NewWallet) -> Result<Wallet, WalletError> {
        let name = validate_name(&input.name)?;
        let currency =
            CurrencyCode::parse(&input.currency).map_err(|_| WalletError::InvalidCurrency)?;
        let definition = CurrencyRepository::require_enabled(&self.pool, &currency)
            .await
            .map_err(map_currency_error)?;
        let opening_balance = parse_opening_balance(&input.opening_balance, definition.exponent)?;
        let wallet_id: Uuid = sqlx::query_scalar(
            "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
             VALUES ($1, $2, $3, $4) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .bind(currency.as_str())
        .bind(opening_balance.decimal())
        .fetch_one(&self.pool)
        .await
        .map_err(|_| WalletError::Persistence)?;
        self.load(user_id, wallet_id).await
    }

    pub async fn update(
        &self,
        user_id: Uuid,
        wallet_id: Uuid,
        input: UpdateWallet,
    ) -> Result<Wallet, WalletError> {
        let Some(name) = input.name else {
            return Err(WalletError::NoChanges);
        };
        let name = validate_name(&name)?;
        sqlx::query(
            "UPDATE wallets
             SET name = $3, updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(wallet_id)
        .bind(name)
        .execute(&self.pool)
        .await
        .map_err(|_| WalletError::Persistence)?;
        self.load(user_id, wallet_id).await
    }

    pub async fn archive(
        &self,
        user_id: Uuid,
        wallet_id: Uuid,
    ) -> Result<ArchiveResult, WalletError> {
        let mut database = self
            .pool
            .begin()
            .await
            .map_err(|_| WalletError::Persistence)?;
        let exists: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM wallets WHERE user_id = $1 AND id = $2 FOR UPDATE")
                .bind(user_id)
                .bind(wallet_id)
                .fetch_optional(&mut *database)
                .await
                .map_err(|_| WalletError::Persistence)?;
        if exists.is_none() {
            return Err(WalletError::NotFound);
        }
        sqlx::query(
            "UPDATE wallets SET archived_at = COALESCE(archived_at, now()), updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(wallet_id)
        .execute(&mut *database)
        .await
        .map_err(|_| WalletError::Persistence)?;
        let paused = sqlx::query("UPDATE recurring_transactions SET status = 'paused', updated_at = now() WHERE user_id = $1 AND wallet_id = $2 AND status = 'active'")
            .bind(user_id).bind(wallet_id).execute(&mut *database).await.map_err(|_| WalletError::Persistence)?;
        database
            .commit()
            .await
            .map_err(|_| WalletError::Persistence)?;
        Ok(ArchiveResult {
            wallet: self.load(user_id, wallet_id).await?,
            paused_recurring_count: paused.rows_affected(),
        })
    }

    pub async fn restore(&self, user_id: Uuid, wallet_id: Uuid) -> Result<Wallet, WalletError> {
        let updated = sqlx::query(
            "UPDATE wallets SET archived_at = NULL, updated_at = now() WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(wallet_id)
        .execute(&self.pool)
        .await
        .map_err(|_| WalletError::Persistence)?;
        if updated.rows_affected() == 0 {
            return Err(WalletError::NotFound);
        }
        self.load(user_id, wallet_id).await
    }

    pub async fn delete(&self, user_id: Uuid, wallet_id: Uuid) -> Result<(), WalletError> {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM wallets WHERE user_id = $1 AND id = $2)",
        )
        .bind(user_id)
        .bind(wallet_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|_| WalletError::Persistence)?;
        if !exists {
            return Err(WalletError::NotFound);
        }
        let deleted = sqlx::query(
            "DELETE FROM wallets w
             WHERE w.user_id = $1 AND w.id = $2
               AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = w.user_id AND t.wallet_id = w.id)
               AND NOT EXISTS (SELECT 1 FROM recurring_transactions r WHERE r.user_id = w.user_id AND r.wallet_id = w.id)",
        )
        .bind(user_id)
        .bind(wallet_id)
        .execute(&self.pool)
        .await
        .map_err(|_| WalletError::Persistence)?;
        if deleted.rows_affected() == 0 {
            return Err(WalletError::HasReferences);
        }
        Ok(())
    }

    async fn load(&self, user_id: Uuid, wallet_id: Uuid) -> Result<Wallet, WalletError> {
        let row =
            sqlx::query_as::<_, WalletRow>(&wallet_query("WHERE w.user_id = $1 AND w.id = $2"))
                .bind(user_id)
                .bind(wallet_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|_| WalletError::Persistence)?
                .ok_or(WalletError::NotFound)?;
        Wallet::try_from(row)
    }
}

impl TryFrom<WalletRow> for Wallet {
    type Error = WalletError;

    fn try_from(row: WalletRow) -> Result<Self, Self::Error> {
        let currency =
            CurrencyCode::parse(&row.currency_code).map_err(|_| WalletError::Persistence)?;
        let exponent = u32::try_from(row.exponent).map_err(|_| WalletError::Persistence)?;
        Ok(Self {
            id: row.id,
            name: row.name,
            currency: currency.clone(),
            opening_balance: format_amount(row.opening_balance, exponent),
            archived_at: row.archived_at.map(|time| time.to_rfc3339()),
            balance: WalletBalance {
                currency,
                amount: format_amount(row.balance, exponent),
                as_of: row.as_of.to_rfc3339(),
            },
        })
    }
}

fn wallet_query(filter: &str) -> String {
    format!(
        "SELECT w.id, w.name, w.currency_code, c.exponent, w.opening_balance, w.archived_at,
                w.opening_balance + COALESCE(SUM(CASE
                    WHEN t.transaction_type = 'INCOME' THEN t.amount
                    WHEN t.transaction_type = 'EXPENSE' THEN -t.amount
                END), 0) AS balance,
                now() AS as_of
         FROM wallets w
         JOIN currencies c ON c.code = w.currency_code
         LEFT JOIN transactions t ON (t.user_id, t.wallet_id) = (w.user_id, w.id)
             AND t.deleted_at IS NULL AND t.occurred_at <= now()
         {filter}
         GROUP BY w.id, w.name, w.currency_code, c.exponent, w.opening_balance, w.archived_at"
    )
}

fn validate_name(input: &str) -> Result<String, WalletError> {
    let name = input.trim();
    if !(1..=80).contains(&name.chars().count()) {
        return Err(WalletError::InvalidName);
    }
    Ok(name.to_owned())
}

fn parse_opening_balance(input: &str, exponent: u32) -> Result<Money, WalletError> {
    Money::parse_for_exponent(input, exponent).map_err(|_| WalletError::InvalidOpeningBalance)
}

fn map_currency_error(error: CurrencyError) -> WalletError {
    match error {
        CurrencyError::NotFound | CurrencyError::Disabled => WalletError::UnsupportedCurrency,
        CurrencyError::Database(_) => WalletError::Persistence,
    }
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
