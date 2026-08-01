//! Money Memo lifecycle and exact purge-deadline boundary.

use serde::{Deserialize, Serialize};

use crate::{DomainError, ErrorCode, Timestamp};

/// Stored lifecycle values.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleStatus {
    /// Visible default journal state.
    Active,
    /// User-archived state.
    Archived,
    /// Recently Deleted before derived expiry.
    PendingDeletion,
}

/// Effective access state including derived values not stored as rows.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EffectiveLifecycle {
    /// Active row.
    Active,
    /// Archived row.
    Archived,
    /// Pending row before deadline.
    PendingDeletion,
    /// Pending row at or after deadline; inaccessible.
    Expired,
    /// No row exists.
    Purged,
}

/// Lifecycle metadata and transitions.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Lifecycle {
    /// Stored state.
    pub status: LifecycleStatus,
    /// Restore target while pending.
    pub pre_delete_status: Option<LifecycleStatus>,
    /// First deletion request.
    pub deletion_requested_at: Option<Timestamp>,
    /// Fixed logical inaccessibility deadline.
    pub purge_deadline: Option<Timestamp>,
}

impl Lifecycle {
    /// New memo lifecycle.
    pub const ACTIVE: Self = Self {
        status: LifecycleStatus::Active,
        pre_delete_status: None,
        deletion_requested_at: None,
        purge_deadline: None,
    };

    /// Validates stored nullable lifecycle fields.
    pub fn validate(self) -> Result<Self, DomainError> {
        match self.status {
            LifecycleStatus::Active | LifecycleStatus::Archived
                if self.pre_delete_status.is_none()
                    && self.deletion_requested_at.is_none()
                    && self.purge_deadline.is_none() =>
            {
                Ok(self)
            }
            LifecycleStatus::PendingDeletion
                if matches!(
                    self.pre_delete_status,
                    Some(LifecycleStatus::Active | LifecycleStatus::Archived)
                ) && self.deletion_requested_at.is_some()
                    && self.purge_deadline.is_some() =>
            {
                Ok(self)
            }
            _ => Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "lifecycle fields are inconsistent",
            )),
        }
    }

    /// Derives state before data mapping. Exact deadline is expired.
    #[must_use]
    pub fn effective(self, now: Timestamp) -> EffectiveLifecycle {
        match self.status {
            LifecycleStatus::Active => EffectiveLifecycle::Active,
            LifecycleStatus::Archived => EffectiveLifecycle::Archived,
            LifecycleStatus::PendingDeletion => {
                if self.purge_deadline.is_some_and(|deadline| now >= deadline) {
                    EffectiveLifecycle::Expired
                } else {
                    EffectiveLifecycle::PendingDeletion
                }
            }
        }
    }
}
