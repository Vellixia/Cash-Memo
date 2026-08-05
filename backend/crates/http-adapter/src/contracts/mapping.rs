//! Audited DTO-domain mapping.

use cashmemo_domain::error::{DomainError as SafeDomainError, ErrorCode as DomainCode};
use cashmemo_domain::label::LabelState as DomainLabelState;
use cashmemo_domain::lifecycle::LifecycleStatus as DomainLifecycle;
use cashmemo_domain::money::Currency;
use cashmemo_domain::money_memo::{
    MoneyMemo as DomainMemo, MoneyMemoType as DomainType, PlannedStatus as DomainPlanned,
    Purpose as DomainPurpose,
};
use cashmemo_domain::occurrence::{LocalWall, Occurrence, UtcOffset, ZoneResolution};
use cashmemo_domain::{CreationId, DomainError, LabelId, Timestamp};

use super::generated::{
    ErrorCode, ErrorResponse, FieldError, LabelReference, LabelState, LifecycleStatus, MoneyMemo,
    MoneyMemoCreateRequest, MoneyMemoType, OccurrenceCreate, PlannedStatus, Purpose,
    SafeDetectorId,
};

/// Validated creation boundary values; owner and server fields remain absent.
pub struct MappedCreate {
    /// Stable compose identifier.
    pub creation_id: CreationId,
    /// Income/expense direction.
    pub memo_type: DomainType,
    /// Canonical request decimal retained until exact money validation.
    pub amount: String,
    /// Pinned registry currency.
    pub currency: Currency,
    /// Validated occurrence identity.
    pub occurrence: Occurrence,
    /// Owner-scoped Category ID.
    pub category_id: LabelId,
    /// Owner-scoped Money Space ID.
    pub money_space_id: LabelId,
    /// Exact note or null.
    pub note: Option<String>,
    /// Planning state.
    pub planned_status: DomainPlanned,
    /// Purpose.
    pub purpose: DomainPurpose,
}

impl std::fmt::Debug for MappedCreate {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MappedCreate([REDACTED])")
    }
}

/// Maps reviewed `OpenAPI` DTO without accepting immutable/internal fields.
pub fn map_create(
    request: MoneyMemoCreateRequest,
    now: Timestamp,
) -> Result<MappedCreate, DomainError> {
    let instant = Timestamp::parse_canonical(&request.occurrence.instant)?;
    let wall = LocalWall::parse(&request.occurrence.local_wall_time)?;
    let offset = UtcOffset::parse(&request.occurrence.utc_offset)?;
    let occurrence = Occurrence::new(instant, wall, offset, ZoneResolution::Unique)?;
    occurrence.validate_range(now)?;
    let note = request.note.filter(|value| !value.is_empty());
    Ok(MappedCreate {
        creation_id: CreationId::parse(&request.creation_id)?,
        memo_type: match request.memo_type {
            MoneyMemoType::Income => DomainType::Income,
            MoneyMemoType::Expense => DomainType::Expense,
        },
        amount: request.amount,
        currency: Currency::parse(&request.currency)?,
        occurrence,
        category_id: LabelId::parse(&request.category_id)?,
        money_space_id: LabelId::parse(&request.money_space_id)?,
        note,
        planned_status: match request.planned_status {
            PlannedStatus::Planned => DomainPlanned::Planned,
            PlannedStatus::Unplanned => DomainPlanned::Unplanned,
        },
        purpose: match request.purpose {
            Purpose::Personal => DomainPurpose::Personal,
            Purpose::Work => DomainPurpose::Work,
            Purpose::Mixed => DomainPurpose::Mixed,
        },
    })
}

/// Maps state string without exposing label internals.
#[must_use]
pub const fn label_state(value: DomainLabelState) -> LabelState {
    match value {
        DomainLabelState::Active => LabelState::Active,
        DomainLabelState::Deactivated => LabelState::Deactivated,
    }
}

/// Maps domain aggregate to public DTO with required nullable purge deadline.
pub fn map_money_memo(value: &DomainMemo) -> Result<MoneyMemo, DomainError> {
    Ok(MoneyMemo {
        id: value.id.to_string(),
        memo_type: match value.memo_type {
            DomainType::Income => MoneyMemoType::Income,
            DomainType::Expense => MoneyMemoType::Expense,
        },
        amount: value.money.decimal(),
        currency: value.money.currency().code().to_owned(),
        amount_minor_unit_scale: value.money.currency().scale(),
        occurrence: OccurrenceCreate {
            instant: value.occurrence.instant().to_canonical()?,
            local_wall_time: value.occurrence.wall().canonical(),
            utc_offset: value.occurrence.offset().canonical(),
        },
        category: LabelReference {
            id: value.category.id.to_string(),
            name: value.category.name.clone(),
            state: label_state(value.category.state),
        },
        money_space: LabelReference {
            id: value.money_space.id.to_string(),
            name: value.money_space.name.clone(),
            state: label_state(value.money_space.state),
        },
        note: value.note.clone(),
        planned_status: match value.planned_status {
            DomainPlanned::Planned => PlannedStatus::Planned,
            DomainPlanned::Unplanned => PlannedStatus::Unplanned,
        },
        purpose: match value.purpose {
            DomainPurpose::Personal => Purpose::Personal,
            DomainPurpose::Work => Purpose::Work,
            DomainPurpose::Mixed => Purpose::Mixed,
        },
        lifecycle_status: match value.lifecycle.status {
            DomainLifecycle::Active => LifecycleStatus::Active,
            DomainLifecycle::Archived => LifecycleStatus::Archived,
            DomainLifecycle::PendingDeletion => LifecycleStatus::PendingDeletion,
        },
        purge_deadline: value.purge_deadline()?,
        revision: value.revision.get(),
        created_at: value.created_at.to_canonical()?,
        updated_at: value.updated_at.to_canonical()?,
    })
}

fn error_code(value: DomainCode) -> ErrorCode {
    match value {
        DomainCode::AuthRequired => ErrorCode::AuthRequired,
        DomainCode::NotFound => ErrorCode::NotFound,
        DomainCode::ValidationFailed => ErrorCode::ValidationFailed,
        DomainCode::PrivacyInputRejected => ErrorCode::PrivacyInputRejected,
        DomainCode::CreationIdentifierConflict => ErrorCode::CreationIdentifierConflict,
        DomainCode::RevisionConflict => ErrorCode::RevisionConflict,
        DomainCode::CurrencyChangeConfirmationRequired => {
            ErrorCode::CurrencyChangeConfirmationRequired
        }
        DomainCode::OffsetChangeConfirmationRequired => ErrorCode::OffsetChangeConfirmationRequired,
        DomainCode::LabelNameConflict => ErrorCode::LabelNameConflict,
        DomainCode::LabelInUse => ErrorCode::LabelInUse,
        DomainCode::ExportInProgress => ErrorCode::ExportInProgress,
        DomainCode::ExportConsistencyUnavailable => ErrorCode::ExportConsistencyUnavailable,
        DomainCode::IdempotencyVerificationUnavailable => {
            ErrorCode::IdempotencyVerificationUnavailable
        }
        DomainCode::PurgeLedgerUnavailable => ErrorCode::PurgeLedgerUnavailable,
        DomainCode::PagePositionInvalid => ErrorCode::PagePositionInvalid,
        DomainCode::PagePositionExpired => ErrorCode::PagePositionExpired,
        DomainCode::PageSizeInvalid => ErrorCode::PageSizeInvalid,
        DomainCode::ListChanged => ErrorCode::ListChanged,
        DomainCode::DependencyUnavailable => ErrorCode::DependencyUnavailable,
    }
}

fn safe_detector(value: &str) -> Option<SafeDetectorId> {
    match value {
        "B1_PAN_LUHN" => Some(SafeDetectorId::B1PanLuhn),
        "B2_IBAN_MOD97" => Some(SafeDetectorId::B2IbanMod97),
        "B3_LABELED_ACCOUNT" => Some(SafeDetectorId::B3LabeledAccount),
        "B4_LABELED_ROUTING" => Some(SafeDetectorId::B4LabeledRouting),
        "B5_LABELED_CARD_SECRET" => Some(SafeDetectorId::B5LabeledCardSecret),
        "B6_LABELED_BANK_CREDENTIAL" => Some(SafeDetectorId::B6LabeledBankCredential),
        "B7_LABELED_BANK_TOKEN" => Some(SafeDetectorId::B7LabeledBankToken),
        "B8_STATEMENT_PASTE" => Some(SafeDetectorId::B8StatementPaste),
        "B9_LABELED_GOV_ID" => Some(SafeDetectorId::B9LabeledGovId),
        _ => None,
    }
}

/// Stable HTTP status for domain code.
#[must_use]
pub const fn http_status(code: DomainCode) -> u16 {
    match code {
        DomainCode::AuthRequired => 401,
        DomainCode::NotFound => 404,
        DomainCode::ValidationFailed | DomainCode::PrivacyInputRejected => 422,
        DomainCode::CreationIdentifierConflict
        | DomainCode::RevisionConflict
        | DomainCode::CurrencyChangeConfirmationRequired
        | DomainCode::OffsetChangeConfirmationRequired
        | DomainCode::LabelNameConflict
        | DomainCode::LabelInUse
        | DomainCode::ExportInProgress
        | DomainCode::PagePositionInvalid
        | DomainCode::PagePositionExpired
        | DomainCode::PageSizeInvalid
        | DomainCode::ListChanged => 409,
        DomainCode::ExportConsistencyUnavailable
        | DomainCode::IdempotencyVerificationUnavailable
        | DomainCode::PurgeLedgerUnavailable
        | DomainCode::DependencyUnavailable => 503,
    }
}

/// Maps safe error fields without current resources, candidate values, or derivatives.
#[must_use]
pub fn map_error(error: &SafeDomainError, request_id: String) -> ErrorResponse {
    ErrorResponse {
        code: error_code(error.code),
        message: error.message.to_owned(),
        request_id,
        retryable: error.retryable,
        field_errors: error
            .violations
            .iter()
            .map(|violation| FieldError {
                field: violation.field.to_owned(),
                rule: violation.rule.to_owned(),
                message: violation.message.to_owned(),
                detector_id: violation.detector_id.and_then(safe_detector),
            })
            .collect(),
        current: None,
        existing_memo_id: error.existing_memo_id.map(|id| id.to_string()),
        refresh_required: None,
    }
}
