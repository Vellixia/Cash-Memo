//! Exact minor-unit money and pinned currency-scale validation.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::{DomainError, ErrorCode};

const MAX_MAJOR: u64 = 999_999_999_999;
const REGISTRY: &str =
    include_str!("../../../../shared/currencies/iso4217-list-one-2026-01-01.json");

#[derive(Deserialize)]
struct Registry {
    currencies: Vec<RegistryCurrency>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryCurrency {
    code: String,
    minor_unit_scale: u8,
}

fn scales() -> &'static BTreeMap<String, u8> {
    static SCALES: OnceLock<BTreeMap<String, u8>> = OnceLock::new();
    SCALES.get_or_init(|| {
        let registry: Registry = serde_json::from_str(REGISTRY).unwrap_or_else(|_| Registry {
            currencies: Vec::new(),
        });
        registry
            .currencies
            .into_iter()
            .map(|currency| (currency.code, currency.minor_unit_scale))
            .collect()
    })
}

/// Supported ISO currency and immutable v1 minor-unit scale.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct Currency {
    code: String,
    scale: u8,
}

impl Currency {
    /// Looks up uppercase code in pinned registry.
    pub fn parse(code: &str) -> Result<Self, DomainError> {
        if !code.bytes().all(|byte| byte.is_ascii_uppercase()) || code.len() != 3 {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "currency code is invalid",
            ));
        }
        let scale = scales().get(code).copied().ok_or_else(|| {
            DomainError::safe(ErrorCode::ValidationFailed, "currency is unsupported")
        })?;
        Ok(Self {
            code: code.to_owned(),
            scale,
        })
    }

    /// Returns ISO code.
    #[must_use]
    pub fn code(&self) -> &str {
        &self.code
    }

    /// Returns registry minor-unit scale.
    #[must_use]
    pub const fn scale(&self) -> u8 {
        self.scale
    }
}

impl std::fmt::Debug for Currency {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Currency([REDACTED])")
    }
}

/// Positive exact monetary magnitude in minor units.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct Money {
    minor: u64,
    currency: Currency,
}

impl Money {
    /// Parses canonical unsigned decimal and pads to exact currency scale without rounding.
    pub fn parse(decimal: &str, currency: Currency) -> Result<Self, DomainError> {
        if decimal.is_empty()
            || decimal.starts_with(['+', '-'])
            || decimal.contains([',', 'e', 'E'])
            || decimal
                .chars()
                .filter(|character| *character == '.')
                .count()
                > 1
        {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "amount must be an unsigned canonical decimal; direction is set by type",
            ));
        }
        let (whole, fraction) = decimal.split_once('.').map_or((decimal, ""), |parts| parts);
        if whole.is_empty()
            || (decimal.contains('.') && fraction.is_empty())
            || !whole.bytes().all(|byte| byte.is_ascii_digit())
            || !fraction.bytes().all(|byte| byte.is_ascii_digit())
            || (whole.len() > 1 && whole.starts_with('0'))
        {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "amount format is invalid",
            ));
        }
        if fraction.len() > usize::from(currency.scale) {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "amount exceeds currency minor-unit precision",
            ));
        }
        let major = whole.parse::<u64>().map_err(|_| {
            DomainError::safe(ErrorCode::ValidationFailed, "amount exceeds maximum")
        })?;
        if major > MAX_MAJOR {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "amount exceeds maximum",
            ));
        }
        let factor = 10_u64.pow(u32::from(currency.scale));
        let fraction_value = if fraction.is_empty() {
            0
        } else {
            fraction.parse::<u64>().map_err(|_| {
                DomainError::safe(ErrorCode::ValidationFailed, "amount format is invalid")
            })? * 10_u64.pow(u32::from(currency.scale) - u32::try_from(fraction.len()).unwrap_or(0))
        };
        let minor = major
            .checked_mul(factor)
            .and_then(|value| value.checked_add(fraction_value))
            .ok_or_else(|| {
                DomainError::safe(ErrorCode::ValidationFailed, "amount exceeds maximum")
            })?;
        if minor == 0 {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "amount must be greater than zero",
            ));
        }
        let maximum_minor = MAX_MAJOR
            .checked_mul(factor)
            .and_then(|value| value.checked_add(factor - 1))
            .ok_or_else(|| {
                DomainError::safe(ErrorCode::ValidationFailed, "amount exceeds maximum")
            })?;
        if minor > maximum_minor {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "amount exceeds maximum",
            ));
        }
        Ok(Self { minor, currency })
    }

    /// Exact minor integer.
    #[must_use]
    pub const fn minor(&self) -> u64 {
        self.minor
    }

    /// Currency.
    #[must_use]
    pub const fn currency(&self) -> &Currency {
        &self.currency
    }

    /// Renders with exactly registry scale digits.
    #[must_use]
    pub fn decimal(&self) -> String {
        let scale = self.currency.scale;
        if scale == 0 {
            return self.minor.to_string();
        }
        let factor = 10_u64.pow(u32::from(scale));
        format!(
            "{}.{:0width$}",
            self.minor / factor,
            self.minor % factor,
            width = usize::from(scale)
        )
    }
}

impl std::fmt::Debug for Money {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Money([REDACTED])")
    }
}
