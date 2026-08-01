//! Injectable production and manual clocks.

use std::sync::{Arc, RwLock};

use cashmemo_domain::{DomainError, ErrorCode, Timestamp};

/// Domain time source.
pub trait Clock: Send + Sync {
    /// Current exact UTC domain instant.
    fn now(&self) -> Result<Timestamp, DomainError>;
}

/// Production system UTC clock.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Result<Timestamp, DomainError> {
        let micros = chrono_like_system_micros()?;
        Ok(Timestamp::from_micros(micros))
    }
}

fn chrono_like_system_micros() -> Result<i64, DomainError> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| {
            DomainError::retryable(ErrorCode::DependencyUnavailable, "system clock unavailable")
        })?;
    i64::try_from(duration.as_micros()).map_err(|_| {
        DomainError::retryable(ErrorCode::DependencyUnavailable, "system clock unavailable")
    })
}

/// Thread-safe controllable clock for tests and operational drills.
#[derive(Clone, Debug)]
pub struct ManualClock(Arc<RwLock<Timestamp>>);

impl ManualClock {
    /// Creates a clock at exact instant.
    #[must_use]
    pub fn new(initial: Timestamp) -> Self {
        Self(Arc::new(RwLock::new(initial)))
    }

    /// Moves clock deterministically.
    pub fn set(&self, value: Timestamp) -> Result<(), DomainError> {
        *self.0.write().map_err(|_| {
            DomainError::retryable(ErrorCode::DependencyUnavailable, "manual clock unavailable")
        })? = value;
        Ok(())
    }
}

impl Clock for ManualClock {
    fn now(&self) -> Result<Timestamp, DomainError> {
        self.0.read().map(|value| *value).map_err(|_| {
            DomainError::retryable(ErrorCode::DependencyUnavailable, "manual clock unavailable")
        })
    }
}
