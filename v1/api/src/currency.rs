use std::fmt;

use serde::Serialize;
use sqlx::PgPool;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CurrencyCode(String);

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CurrencyCodeError {
    #[error("currency code must be exactly three uppercase ASCII letters")]
    Invalid,
}

impl CurrencyCode {
    pub fn parse(input: &str) -> Result<Self, CurrencyCodeError> {
        if input.len() == 3 && input.bytes().all(|byte| byte.is_ascii_uppercase()) {
            Ok(Self(input.to_owned()))
        } else {
            Err(CurrencyCodeError::Invalid)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CurrencyCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl Serialize for CurrencyCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CurrencyDefinition {
    pub code: CurrencyCode,
    pub display_name: String,
    pub exponent: u32,
    pub enabled: bool,
}

#[derive(Debug, Error)]
pub enum CurrencyError {
    #[error("currency is not configured")]
    NotFound,
    #[error("currency is disabled")]
    Disabled,
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

impl PartialEq for CurrencyError {
    fn eq(&self, other: &Self) -> bool {
        matches!(
            (self, other),
            (Self::NotFound, Self::NotFound) | (Self::Disabled, Self::Disabled)
        )
    }
}

impl Eq for CurrencyError {}

pub struct CurrencyRepository;

impl CurrencyRepository {
    pub async fn require_enabled(
        pool: &PgPool,
        code: &CurrencyCode,
    ) -> Result<CurrencyDefinition, CurrencyError> {
        let row: Option<(String, String, i32, bool)> = sqlx::query_as(
            "SELECT code, display_name, exponent, enabled FROM currencies WHERE code = $1",
        )
        .bind(code.as_str())
        .fetch_optional(pool)
        .await?;

        let Some((code, display_name, exponent, enabled)) = row else {
            return Err(CurrencyError::NotFound);
        };
        if !enabled {
            return Err(CurrencyError::Disabled);
        }

        Ok(CurrencyDefinition {
            code: CurrencyCode::parse(&code)
                .expect("currencies.code must satisfy its database check"),
            display_name,
            exponent: exponent as u32,
            enabled,
        })
    }

    pub async fn enabled(pool: &PgPool) -> Result<Vec<CurrencyDefinition>, CurrencyError> {
        let rows: Vec<(String, String, i32, bool)> = sqlx::query_as(
            "SELECT code, display_name, exponent, enabled FROM currencies WHERE enabled ORDER BY code",
        )
        .fetch_all(pool)
        .await?;

        rows.into_iter()
            .map(|(code, display_name, exponent, enabled)| {
                Ok(CurrencyDefinition {
                    code: CurrencyCode::parse(&code)
                        .expect("currencies.code must satisfy its database check"),
                    display_name,
                    exponent: exponent as u32,
                    enabled,
                })
            })
            .collect()
    }
}

#[derive(Serialize)]
pub struct EnabledCurrencyResponse {
    pub code: CurrencyCode,
    pub display_name: String,
    pub exponent: u32,
}

impl From<CurrencyDefinition> for EnabledCurrencyResponse {
    fn from(value: CurrencyDefinition) -> Self {
        Self {
            code: value.code,
            display_name: value.display_name,
            exponent: value.exponent,
        }
    }
}
