//! Stable safe domain errors.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::MoneyMemoId;

/// Stable caller-visible error code.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// Missing or invalid session.
    AuthRequired,
    /// Resource absent, inaccessible, expired, or other-owner.
    NotFound,
    /// One or more fields failed validation.
    ValidationFailed,
    /// Pattern Set v1 blocking result.
    PrivacyInputRejected,
    /// Creation ID reused with different original input.
    CreationIdentifierConflict,
    /// Caller revision stale.
    RevisionConflict,
    /// Currency re-declaration requires confirmation.
    CurrencyChangeConfirmationRequired,
    /// Offset movement requires confirmation.
    OffsetChangeConfirmationRequired,
    /// Case-folded label name already exists.
    LabelNameConflict,
    /// Referenced label cannot be deleted.
    LabelInUse,
    /// Export fence blocks mutation.
    ExportInProgress,
    /// Export cannot provide documented consistency.
    ExportConsistencyUnavailable,
    /// Fingerprint key cannot be verified.
    IdempotencyVerificationUnavailable,
    /// Suppression ledger unavailable.
    PurgeLedgerUnavailable,
    /// Page position malformed or bound incorrectly.
    PagePositionInvalid,
    /// Page position expired.
    PagePositionExpired,
    /// Page size invalid.
    PageSizeInvalid,
    /// Result-set version changed.
    ListChanged,
    /// Required dependency unavailable.
    DependencyUnavailable,
}

/// One safe field/rule violation. Submitted values are structurally absent.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct FieldViolation {
    /// Public field path.
    pub field: &'static str,
    /// Stable rule identifier.
    pub rule: &'static str,
    /// Safe correction guidance with no value.
    pub message: &'static str,
    /// Optional published safe blocking detector ID.
    pub detector_id: Option<&'static str>,
}

impl fmt::Debug for FieldViolation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FieldViolation")
            .field("field", &self.field)
            .field("rule", &self.rule)
            .field("message", &self.message)
            .field("detector_id", &self.detector_id)
            .finish()
    }
}

/// Domain failure containing only allowlisted diagnostic data.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct DomainError {
    /// Stable code.
    pub code: ErrorCode,
    /// Safe static message.
    pub message: &'static str,
    /// Retry recommendation.
    pub retryable: bool,
    /// Aggregated safe violations.
    pub violations: Vec<FieldViolation>,
    /// Optional same-owner memo ID allowed only for creation-ID conflict responses.
    pub existing_memo_id: Option<MoneyMemoId>,
}

impl DomainError {
    /// Constructs a safe non-retryable error.
    #[must_use]
    pub const fn safe(code: ErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            retryable: false,
            violations: Vec::new(),
            existing_memo_id: None,
        }
    }

    /// Constructs a safe retryable error.
    #[must_use]
    pub const fn retryable(code: ErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message,
            retryable: true,
            violations: Vec::new(),
            existing_memo_id: None,
        }
    }

    /// Constructs aggregated validation failure.
    #[must_use]
    pub fn validation(violations: Vec<FieldViolation>) -> Self {
        Self {
            code: ErrorCode::ValidationFailed,
            message: "one or more fields are invalid",
            retryable: false,
            violations,
            existing_memo_id: None,
        }
    }

    /// Adds the same-owner existing memo ID to a creation identifier conflict.
    #[must_use]
    pub const fn with_existing_memo(mut self, id: MoneyMemoId) -> Self {
        self.existing_memo_id = Some(id);
        self
    }
}

impl fmt::Debug for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DomainError")
            .field("code", &self.code)
            .field("message", &self.message)
            .field("retryable", &self.retryable)
            .field("violations", &self.violations)
            .field("has_existing_memo", &self.existing_memo_id.is_some())
            .finish()
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for DomainError {}
