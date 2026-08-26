use std::str::FromStr;

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
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

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LocalCalendarError {
    #[error("local calendar boundary is outside supported range")]
    OutOfRange,
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

pub fn first_valid_instant_at_or_after_midnight(
    timezone: Tz,
    date: NaiveDate,
) -> Result<DateTime<Utc>, LocalCalendarError> {
    let requested = date
        .and_hms_opt(0, 0, 0)
        .ok_or(LocalCalendarError::OutOfRange)?;
    match timezone.from_local_datetime(&requested) {
        LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
        LocalResult::Ambiguous(first, second) => Ok(first.min(second).with_timezone(&Utc)),
        LocalResult::None => first_valid_after_nonexistent_midnight(timezone, requested),
    }
}

pub fn local_date_range(
    timezone: Tz,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<(DateTime<Utc>, DateTime<Utc>), LocalCalendarError> {
    let end_date = to.succ_opt().ok_or(LocalCalendarError::OutOfRange)?;
    Ok((
        first_valid_instant_at_or_after_midnight(timezone, from)?,
        first_valid_instant_at_or_after_midnight(timezone, end_date)?,
    ))
}

pub fn local_month_range(
    timezone: Tz,
    month: NaiveDate,
) -> Result<(DateTime<Utc>, DateTime<Utc>), LocalCalendarError> {
    let next = if month.month() == 12 {
        NaiveDate::from_ymd_opt(month.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(month.year(), month.month() + 1, 1)
    }
    .ok_or(LocalCalendarError::OutOfRange)?;
    local_date_range(
        timezone,
        month,
        next.pred_opt().ok_or(LocalCalendarError::OutOfRange)?,
    )
}

fn first_valid_after_nonexistent_midnight(
    timezone: Tz,
    requested: NaiveDateTime,
) -> Result<DateTime<Utc>, LocalCalendarError> {
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
            .ok_or(LocalCalendarError::OutOfRange)?;
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
        LocalResult::None => Err(LocalCalendarError::OutOfRange),
    }
}

fn add_seconds(value: NaiveDateTime, seconds: i64) -> Result<NaiveDateTime, LocalCalendarError> {
    value
        .checked_add_signed(Duration::seconds(seconds))
        .ok_or(LocalCalendarError::OutOfRange)
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::first_valid_instant_at_or_after_midnight;

    #[test]
    fn skipped_local_date_uses_first_instant_after_the_gap() {
        let instant = first_valid_instant_at_or_after_midnight(
            chrono_tz::Pacific::Apia,
            NaiveDate::from_ymd_opt(2011, 12, 30).unwrap(),
        )
        .unwrap();

        assert_eq!(instant.to_rfc3339(), "2011-12-30T10:00:00+00:00");
    }
}
