use chrono_tz::Tz;
use serde::Serialize;
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

const STARTER_KEYS: &[&str] = &[
    "starter_expense_food_drink",
    "starter_expense_transport",
    "starter_expense_housing",
    "starter_expense_utilities",
    "starter_expense_shopping",
    "starter_expense_health",
    "starter_expense_education",
    "starter_expense_entertainment",
    "starter_expense_travel",
    "starter_expense_software_services",
    "starter_expense_fees",
    "starter_expense_other",
    "starter_income_salary",
    "starter_income_freelance",
    "starter_income_business",
    "starter_income_gift",
    "starter_income_refund",
    "starter_income_other",
];

#[derive(Clone)]
pub struct OnboardingService {
    pool: PgPool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct OnboardingState {
    pub timezone_configured: bool,
    pub default_currency_configured: bool,
    pub default_currency_code: Option<String>,
    pub categories_seeded: bool,
    pub has_active_wallet: bool,
}

#[derive(Debug, Eq, PartialEq)]
pub struct Preferences {
    pub timezone: String,
    pub default_currency_code: String,
}

#[derive(Debug, Error)]
pub enum OnboardingError {
    #[error("timezone is not a valid IANA timezone")]
    InvalidTimezone,
    #[error("currency is not enabled")]
    UnsupportedCurrency,
    #[error("onboarding persistence failed")]
    Persistence,
}

impl OnboardingService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn state(&self, user_id: Uuid) -> Result<OnboardingState, OnboardingError> {
        sqlx::query_as::<_, (bool, Option<String>, bool, bool)>(
            "SELECT
                u.timezone_configured_at IS NOT NULL,
                u.default_currency_code,
                (SELECT count(*) FROM categories c
                    WHERE c.user_id = u.id AND c.starter_key = ANY($2)) = $3,
                EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id AND w.archived_at IS NULL)
             FROM users u WHERE u.id = $1",
        )
        .bind(user_id)
        .bind(STARTER_KEYS)
        .bind(STARTER_KEYS.len() as i64)
        .fetch_one(&self.pool)
        .await
        .map(
            |(timezone_configured, default_currency_code, categories_seeded, has_active_wallet)| {
                OnboardingState {
                    timezone_configured,
                    default_currency_configured: default_currency_code.is_some(),
                    default_currency_code,
                    categories_seeded,
                    has_active_wallet,
                }
            },
        )
        .map_err(|_| OnboardingError::Persistence)
    }

    pub async fn update_preferences(
        &self,
        user_id: Uuid,
        preferences: Preferences,
    ) -> Result<(), OnboardingError> {
        let _: Tz = preferences
            .timezone
            .parse()
            .map_err(|_| OnboardingError::InvalidTimezone)?;
        let updated = sqlx::query(
            "UPDATE users
             SET timezone = $2, timezone_configured_at = now(), default_currency_code = $3, updated_at = now()
             WHERE id = $1
               AND EXISTS (SELECT 1 FROM currencies WHERE code = $3 AND enabled)",
        )
        .bind(user_id)
        .bind(preferences.timezone)
        .bind(preferences.default_currency_code)
        .execute(&self.pool)
        .await
        .map_err(|_| OnboardingError::Persistence)?;
        if updated.rows_affected() == 0 {
            return Err(OnboardingError::UnsupportedCurrency);
        }
        Ok(())
    }

    pub async fn seed_categories(&self, user_id: Uuid) -> Result<(), OnboardingError> {
        sqlx::query(
            "INSERT INTO categories (user_id, name, normalized_name, transaction_type, starter_key) VALUES
                ($1, 'Food & Drink', 'food & drink', 'EXPENSE', 'starter_expense_food_drink'),
                ($1, 'Transport', 'transport', 'EXPENSE', 'starter_expense_transport'),
                ($1, 'Housing', 'housing', 'EXPENSE', 'starter_expense_housing'),
                ($1, 'Utilities', 'utilities', 'EXPENSE', 'starter_expense_utilities'),
                ($1, 'Shopping', 'shopping', 'EXPENSE', 'starter_expense_shopping'),
                ($1, 'Health', 'health', 'EXPENSE', 'starter_expense_health'),
                ($1, 'Education', 'education', 'EXPENSE', 'starter_expense_education'),
                ($1, 'Entertainment', 'entertainment', 'EXPENSE', 'starter_expense_entertainment'),
                ($1, 'Travel', 'travel', 'EXPENSE', 'starter_expense_travel'),
                ($1, 'Software & Services', 'software & services', 'EXPENSE', 'starter_expense_software_services'),
                ($1, 'Fees', 'fees', 'EXPENSE', 'starter_expense_fees'),
                ($1, 'Other Expense', 'other expense', 'EXPENSE', 'starter_expense_other'),
                ($1, 'Salary', 'salary', 'INCOME', 'starter_income_salary'),
                ($1, 'Freelance', 'freelance', 'INCOME', 'starter_income_freelance'),
                ($1, 'Business', 'business', 'INCOME', 'starter_income_business'),
                ($1, 'Gift', 'gift', 'INCOME', 'starter_income_gift'),
                ($1, 'Refund', 'refund', 'INCOME', 'starter_income_refund'),
                ($1, 'Other Income', 'other income', 'INCOME', 'starter_income_other')
             ON CONFLICT (user_id, starter_key) DO NOTHING",
        )
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map(|_| ())
        .map_err(|_| OnboardingError::Persistence)
    }
}
