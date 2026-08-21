use std::str::FromStr;

use chrono_tz::Tz;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserTimezone(Tz);

#[derive(Debug, Error, PartialEq, Eq)]
pub enum UserTimezoneError {
    #[error("timezone must be a valid IANA timezone")]
    Invalid,
}

impl UserTimezone {
    pub fn parse(input: &str) -> Result<Self, UserTimezoneError> {
        Tz::from_str(input)
            .map(Self)
            .map_err(|_| UserTimezoneError::Invalid)
    }

    pub fn as_str(&self) -> &str {
        self.0.name()
    }
}
