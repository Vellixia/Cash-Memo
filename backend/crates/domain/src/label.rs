//! Category and Money Space identity and normalization.

use serde::{Deserialize, Serialize};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use crate::{DomainError, ErrorCode, LabelId, OwnerId, Revision, Timestamp};

/// Typed label family.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LabelKind {
    /// Category.
    Category,
    /// Money Space.
    MoneySpace,
}

/// Label availability for new references.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LabelState {
    /// Available for compose.
    Active,
    /// Preserved for existing references, absent from picker.
    Deactivated,
}

/// Full Unicode NFKC case-folded trimmed uniqueness key.
#[must_use]
pub fn normalized_name(name: &str) -> String {
    name.trim().nfkc().case_fold().collect()
}

/// User-owned Category or Money Space.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct Label {
    /// Opaque ID.
    pub id: LabelId,
    /// Owner from authenticated principal.
    pub owner: OwnerId,
    /// Typed family.
    pub kind: LabelKind,
    /// User-visible trimmed name.
    pub name: String,
    /// Internal uniqueness key.
    pub name_key: String,
    /// Current state.
    pub state: LabelState,
    /// All-lifecycle memo references.
    pub memo_reference_count: u64,
    /// Caller-visible revision.
    pub revision: Revision,
    /// Domain timestamps.
    pub created_at: Timestamp,
    /// Domain timestamps.
    pub updated_at: Timestamp,
}

impl Label {
    /// Validates and constructs a label.
    pub fn new(
        id: LabelId,
        owner: OwnerId,
        kind: LabelKind,
        name: &str,
        now: Timestamp,
    ) -> Result<Self, DomainError> {
        let display = name.trim();
        if display.is_empty() || display.chars().count() > 100 {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "label name length is invalid",
            ));
        }
        Ok(Self {
            id,
            owner,
            kind,
            name: display.to_owned(),
            name_key: normalized_name(display),
            state: LabelState::Active,
            memo_reference_count: 0,
            revision: Revision::INITIAL,
            created_at: now,
            updated_at: now,
        })
    }
}

impl std::fmt::Debug for Label {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Label([REDACTED])")
    }
}
