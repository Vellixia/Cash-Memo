//! Canonical identifiers, revisions, and timestamps.

use std::fmt;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{DomainError, ErrorCode};

macro_rules! opaque_uuid {
    ($name:ident) => {
        #[doc = concat!("Opaque canonical ", stringify!($name), ".")]
        #[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            /// Constructs from an already validated UUID.
            #[must_use]
            pub const fn new(value: Uuid) -> Self {
                Self(value)
            }

            /// Generates a random opaque `UUIDv4`.
            #[must_use]
            pub fn random() -> Self {
                Self(Uuid::new_v4())
            }

            /// Parses canonical lowercase hyphenated UUID text.
            pub fn parse(value: &str) -> Result<Self, DomainError> {
                let parsed = Uuid::parse_str(value).map_err(|_| {
                    DomainError::safe(ErrorCode::ValidationFailed, "identifier is invalid")
                })?;
                if parsed.hyphenated().to_string() != value {
                    return Err(DomainError::safe(
                        ErrorCode::ValidationFailed,
                        "identifier must be canonical lowercase UUID",
                    ));
                }
                Ok(Self(parsed))
            }

            /// Returns canonical lowercase text.
            #[must_use]
            pub fn as_uuid(self) -> Uuid {
                self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.hyphenated().fmt(formatter)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(concat!(stringify!($name), "([REDACTED])"))
            }
        }
    };
}

opaque_uuid!(MoneyMemoId);
opaque_uuid!(CreationId);
opaque_uuid!(LabelId);

/// Opaque account identifier derived only from a validated session.
#[derive(Clone, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OwnerId(String);

impl OwnerId {
    /// Validates the authenticated-account alphabet and 36-character bound.
    pub fn parse_authenticated_account(value: &str) -> Result<Self, DomainError> {
        let valid_length = !value.is_empty() && value.len() <= 36;
        let valid_start = value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric);
        let valid_alphabet = value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
        if !valid_length || !valid_start || !valid_alphabet {
            return Err(DomainError::safe(
                ErrorCode::AuthRequired,
                "authenticated account identifier is invalid",
            ));
        }
        Ok(Self(value.to_owned()))
    }

    /// Internal persistence form. Never place this value in diagnostics.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for OwnerId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("OwnerId([REDACTED])")
    }
}

/// Caller-visible optimistic-concurrency revision.
#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Revision(i64);

impl Revision {
    /// First persisted revision.
    pub const INITIAL: Self = Self(1);

    /// Validates a positive revision.
    pub fn new(value: i64) -> Result<Self, DomainError> {
        if value < 1 {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "revision must be positive",
            ));
        }
        Ok(Self(value))
    }

    /// Returns primitive revision.
    #[must_use]
    pub const fn get(self) -> i64 {
        self.0
    }

    /// Increments revision or reports fail-closed overflow.
    pub fn next(self) -> Result<Self, DomainError> {
        self.0.checked_add(1).map(Self).ok_or_else(|| {
            DomainError::safe(ErrorCode::DependencyUnavailable, "revision unavailable")
        })
    }
}

impl fmt::Debug for Revision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_tuple("Revision").field(&self.0).finish()
    }
}

/// Exact UTC microsecond instant used as domain truth.
#[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp(i64);

impl Timestamp {
    /// Constructs from signed Unix epoch microseconds.
    #[must_use]
    pub const fn from_micros(value: i64) -> Self {
        Self(value)
    }

    /// Returns signed Unix epoch microseconds.
    #[must_use]
    pub const fn as_micros(self) -> i64 {
        self.0
    }

    /// Parses only canonical six-fractional-digit UTC text.
    pub fn parse_canonical(value: &str) -> Result<Self, DomainError> {
        let parsed = DateTime::parse_from_rfc3339(value)
            .map_err(|_| {
                DomainError::safe(ErrorCode::ValidationFailed, "instant must be canonical UTC")
            })?
            .with_timezone(&Utc);
        let canonical = parsed.to_rfc3339_opts(SecondsFormat::Micros, true);
        if canonical != value {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "instant must use six fractional digits and Z",
            ));
        }
        Ok(Self(parsed.timestamp_micros()))
    }

    /// Renders canonical six-fractional-digit UTC text.
    pub fn to_canonical(self) -> Result<String, DomainError> {
        DateTime::<Utc>::from_timestamp_micros(self.0)
            .map(|value| value.to_rfc3339_opts(SecondsFormat::Micros, true))
            .ok_or_else(|| {
                DomainError::safe(
                    ErrorCode::ValidationFailed,
                    "instant is outside supported range",
                )
            })
    }
}

impl fmt::Debug for Timestamp {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_tuple("Timestamp").field(&self.0).finish()
    }
}
