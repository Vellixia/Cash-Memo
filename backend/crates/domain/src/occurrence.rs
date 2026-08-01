//! Occurrence instant, local wall, captured offset, and display projections.

use chrono::{DateTime, FixedOffset, Months, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{DomainError, ErrorCode, Timestamp};

/// Trust-boundary timezone resolution outcome supplied by a zone-aware UI.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ZoneResolution {
    /// Exactly one matching instant.
    Unique,
    /// An ambiguous time resolved by explicit offset choice.
    AmbiguousOffsetChosen,
    /// No instant exists for wall time in selected zone.
    Nonexistent,
}

/// Fixed local wall time preserving six microsecond digits.
#[derive(Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
pub struct LocalWall(NaiveDateTime);

impl LocalWall {
    /// Parses exact fixed local wall representation.
    pub fn parse(value: &str) -> Result<Self, DomainError> {
        let parsed =
            NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.6f").map_err(|_| {
                DomainError::safe(ErrorCode::ValidationFailed, "local wall time is invalid")
            })?;
        if parsed.format("%Y-%m-%dT%H:%M:%S%.6f").to_string() != value {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "local wall time must use six fractional digits",
            ));
        }
        Ok(Self(parsed))
    }

    /// Exact local date used for deterministic filtering.
    #[must_use]
    pub const fn date(self) -> NaiveDate {
        self.0.date()
    }

    /// Renders fixed six-digit wall time.
    #[must_use]
    pub fn canonical(self) -> String {
        self.0.format("%Y-%m-%dT%H:%M:%S%.6f").to_string()
    }
}

impl std::fmt::Debug for LocalWall {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("LocalWall([REDACTED])")
    }
}

/// Captured UTC offset, including exact ±14:00 extremes only.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UtcOffset(i16);

impl UtcOffset {
    /// Parses `±HH:MM` with exact specification bounds.
    pub fn parse(value: &str) -> Result<Self, DomainError> {
        if value.len() != 6
            || !matches!(value.as_bytes().first(), Some(b'+' | b'-'))
            || value.as_bytes()[3] != b':'
        {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "UTC offset is invalid",
            ));
        }
        let hours = value[1..3]
            .parse::<i16>()
            .map_err(|_| DomainError::safe(ErrorCode::ValidationFailed, "UTC offset is invalid"))?;
        let minutes = value[4..6]
            .parse::<i16>()
            .map_err(|_| DomainError::safe(ErrorCode::ValidationFailed, "UTC offset is invalid"))?;
        if hours > 14 || minutes > 59 || (hours == 14 && minutes != 0) {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "UTC offset is outside supported range",
            ));
        }
        let sign = if value.starts_with('-') { -1 } else { 1 };
        Ok(Self(sign * (hours * 60 + minutes)))
    }

    /// Constructs from validated offset minutes.
    pub fn from_minutes(minutes: i16) -> Result<Self, DomainError> {
        if !(-840..=840).contains(&minutes) {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "UTC offset is outside supported range",
            ));
        }
        Ok(Self(minutes))
    }

    /// Signed minutes.
    #[must_use]
    pub const fn minutes(self) -> i16 {
        self.0
    }

    /// Canonical `±HH:MM`.
    #[must_use]
    pub fn canonical(self) -> String {
        let sign = if self.0 < 0 { '-' } else { '+' };
        let absolute = self.0.unsigned_abs();
        format!("{sign}{:02}:{:02}", absolute / 60, absolute % 60)
    }

    fn fixed(self) -> Result<FixedOffset, DomainError> {
        FixedOffset::east_opt(i32::from(self.0) * 60)
            .ok_or_else(|| DomainError::safe(ErrorCode::ValidationFailed, "UTC offset is invalid"))
    }
}

/// Complete immutable occurrence identity.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct Occurrence {
    instant: Timestamp,
    wall: LocalWall,
    offset: UtcOffset,
}

impl Occurrence {
    /// Validates instant/wall/offset identity and zone resolution.
    pub fn new(
        instant: Timestamp,
        wall: LocalWall,
        offset: UtcOffset,
        resolution: ZoneResolution,
    ) -> Result<Self, DomainError> {
        if resolution == ZoneResolution::Nonexistent {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "local wall time does not exist in selected zone",
            ));
        }
        let fixed = offset.fixed()?;
        let reconstructed = wall
            .0
            .and_local_timezone(fixed)
            .single()
            .ok_or_else(|| {
                DomainError::safe(ErrorCode::ValidationFailed, "occurrence is ambiguous")
            })?
            .with_timezone(&Utc)
            .timestamp_micros();
        if reconstructed != instant.as_micros() {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "occurrence instant, wall time, and offset disagree",
            ));
        }
        Ok(Self {
            instant,
            wall,
            offset,
        })
    }

    /// Applies ±10 calendar-year validation using submitted offset local date.
    pub fn validate_range(&self, now: Timestamp) -> Result<(), DomainError> {
        let now_utc = DateTime::<Utc>::from_timestamp_micros(now.as_micros()).ok_or_else(|| {
            DomainError::safe(
                ErrorCode::ValidationFailed,
                "clock is outside supported range",
            )
        })?;
        let today = now_utc.with_timezone(&self.offset.fixed()?).date_naive();
        let earliest = today.checked_sub_months(Months::new(120)).ok_or_else(|| {
            DomainError::safe(
                ErrorCode::ValidationFailed,
                "clock is outside supported range",
            )
        })?;
        let latest = today.checked_add_months(Months::new(120)).ok_or_else(|| {
            DomainError::safe(
                ErrorCode::ValidationFailed,
                "clock is outside supported range",
            )
        })?;
        if self.wall.date() < earliest || self.wall.date() > latest {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "occurrence date must be within ten years",
            ));
        }
        Ok(())
    }

    /// Exact instant.
    #[must_use]
    pub const fn instant(&self) -> Timestamp {
        self.instant
    }

    /// Stored local wall.
    #[must_use]
    pub const fn wall(&self) -> LocalWall {
        self.wall
    }

    /// Stored offset.
    #[must_use]
    pub const fn offset(&self) -> UtcOffset {
        self.offset
    }

    /// Deterministic stored local date.
    #[must_use]
    pub const fn local_date(&self) -> NaiveDate {
        self.wall.date()
    }

    /// Viewer-zone projection that never mutates stored identity.
    pub fn display_in_offset(&self, viewer: UtcOffset) -> Result<String, DomainError> {
        let utc =
            DateTime::<Utc>::from_timestamp_micros(self.instant.as_micros()).ok_or_else(|| {
                DomainError::safe(
                    ErrorCode::ValidationFailed,
                    "instant is outside supported range",
                )
            })?;
        Ok(utc
            .with_timezone(&viewer.fixed()?)
            .format("%Y-%m-%dT%H:%M:%S%.6f")
            .to_string())
    }
}

impl std::fmt::Debug for Occurrence {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Occurrence([REDACTED])")
    }
}
