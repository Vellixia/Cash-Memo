use std::fmt;

use rust_decimal::Decimal;
use serde::Serialize;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Money(Decimal);

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MoneyError {
    #[error("amount has too many fractional digits")]
    ExcessScale,
    #[error("amount is outside NUMERIC(20,4) range")]
    OutOfRange,
    #[error("amount is not a decimal literal")]
    InvalidFormat,
    #[error("currency exponent must be between zero and four")]
    InvalidExponent,
}

impl Money {
    pub fn parse_for_exponent(input: &str, exponent: u32) -> Result<Self, MoneyError> {
        if exponent > 4 {
            return Err(MoneyError::InvalidExponent);
        }

        let (whole, fractional) = match input.split_once('.') {
            Some((whole, fractional)) => (whole, Some(fractional)),
            None => (input, None),
        };
        if whole.is_empty()
            || !whole.bytes().all(|byte| byte.is_ascii_digit())
            || fractional.is_some_and(|value| {
                value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit())
            })
        {
            return Err(MoneyError::InvalidFormat);
        }
        if fractional.is_some_and(|value| value.len() > exponent as usize) {
            return Err(MoneyError::ExcessScale);
        }

        let decimal = Decimal::from_str_exact(input).map_err(|_| MoneyError::InvalidFormat)?;
        if decimal.trunc().to_string().len() > 16 {
            return Err(MoneyError::OutOfRange);
        }

        Ok(Self(decimal))
    }

    pub fn decimal(&self) -> Decimal {
        self.0
    }
}

impl fmt::Display for Money {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl Serialize for Money {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
