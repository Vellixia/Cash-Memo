//! Money Memo aggregate and cross-field invariants.

use serde::{Deserialize, Serialize};

use crate::label::LabelState;
use crate::lifecycle::{Lifecycle, LifecycleStatus};
use crate::money::Money;
use crate::occurrence::Occurrence;
use crate::{
    CreationId, DomainError, ErrorCode, LabelId, MoneyMemoId, OwnerId, Revision, Timestamp,
};

/// Income or expense direction.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoneyMemoType {
    /// Income.
    Income,
    /// Expense.
    Expense,
}

/// Planning state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannedStatus {
    /// Planned.
    Planned,
    /// Unplanned.
    Unplanned,
}

/// Purpose classification.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Purpose {
    /// Personal.
    Personal,
    /// Work.
    Work,
    /// Mixed.
    Mixed,
}

/// Public label snapshot resolved by owner-scoped repository.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct LabelReference {
    /// Stable label ID.
    pub id: LabelId,
    /// Current display name.
    pub name: String,
    /// Active/deactivated state.
    pub state: LabelState,
}

impl std::fmt::Debug for LabelReference {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("LabelReference([REDACTED])")
    }
}

/// Confirmed Money Memo aggregate.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct MoneyMemo {
    /// Public ID.
    pub id: MoneyMemoId,
    /// Authenticated owner, never DTO input.
    pub owner: OwnerId,
    /// Stable compose creation ID.
    pub creation_id: CreationId,
    /// Direction.
    pub memo_type: MoneyMemoType,
    /// Exact amount.
    pub money: Money,
    /// Occurrence identity.
    pub occurrence: Occurrence,
    /// Category.
    pub category: LabelReference,
    /// Money Space.
    pub money_space: LabelReference,
    /// Exact accepted note or null.
    pub note: Option<String>,
    /// Planning status.
    pub planned_status: PlannedStatus,
    /// Purpose.
    pub purpose: Purpose,
    /// Lifecycle.
    pub lifecycle: Lifecycle,
    /// Caller-visible revision.
    pub revision: Revision,
    /// Creation time.
    pub created_at: Timestamp,
    /// Last user-visible update time.
    pub updated_at: Timestamp,
}

impl MoneyMemo {
    /// Validates aggregate structural invariants.
    pub fn validate(self) -> Result<Self, DomainError> {
        self.lifecycle.validate()?;
        if self
            .note
            .as_ref()
            .is_some_and(|note| note.chars().count() > 1000)
        {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "note exceeds 1000 characters",
            ));
        }
        Ok(self)
    }

    /// Required nullable API purge deadline.
    pub fn purge_deadline(&self) -> Result<Option<String>, DomainError> {
        match self.lifecycle.status {
            LifecycleStatus::Active | LifecycleStatus::Archived => Ok(None),
            LifecycleStatus::PendingDeletion => self
                .lifecycle
                .purge_deadline
                .ok_or_else(|| {
                    DomainError::safe(
                        ErrorCode::ValidationFailed,
                        "pending deletion deadline missing",
                    )
                })?
                .to_canonical()
                .map(Some),
        }
    }
}

impl std::fmt::Debug for MoneyMemo {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MoneyMemo")
            .field("lifecycle", &self.lifecycle.status)
            .field("revision", &self.revision)
            .finish_non_exhaustive()
    }
}
