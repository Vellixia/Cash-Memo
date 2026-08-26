use std::str::FromStr;

use chrono::{DateTime, LocalResult, NaiveDateTime, TimeZone, Utc};
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

    pub fn timezone(&self) -> Tz {
        self.0
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ManualLocalTimeError {
    #[error("local time must use YYYY-MM-DDTHH:mm")]
    InvalidFormat,
    #[error("local time does not exist in timezone")]
    Nonexistent,
}

pub fn parse_local_minute(input: &str) -> Result<NaiveDateTime, ManualLocalTimeError> {
    let bytes = input.as_bytes();
    if bytes.len() != 16
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || !bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13) || byte.is_ascii_digit())
    {
        return Err(ManualLocalTimeError::InvalidFormat);
    }
    NaiveDateTime::parse_from_str(input, "%Y-%m-%dT%H:%M")
        .map_err(|_| ManualLocalTimeError::InvalidFormat)
}

pub fn resolve_manual_local(
    timezone: Tz,
    local: NaiveDateTime,
) -> Result<DateTime<Utc>, ManualLocalTimeError> {
    match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
        LocalResult::Ambiguous(first, second) => Ok(first.min(second).with_timezone(&Utc)),
        LocalResult::None => Err(ManualLocalTimeError::Nonexistent),
    }
}
