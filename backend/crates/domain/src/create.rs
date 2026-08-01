//! Raw create validation and canonical immutable creation document.

use serde_json::{Map, Value, json};

use crate::money::{Currency, Money};
use crate::money_memo::{MoneyMemoType, PlannedStatus, Purpose};
use crate::occurrence::{LocalWall, Occurrence, UtcOffset, ZoneResolution};
use crate::{CreationId, DomainError, FieldViolation, LabelId, OwnerId, Timestamp};

/// Untrusted create values before aggregated domain validation.
#[derive(Clone)]
pub struct CreateCandidate {
    /// Stable client-generated compose ID.
    pub creation_id: String,
    /// Required direction.
    pub memo_type: Option<MoneyMemoType>,
    /// Canonical decimal request text.
    pub amount: String,
    /// Pinned currency code.
    pub currency: String,
    /// Canonical UTC occurrence instant.
    pub occurrence_instant: String,
    /// Local occurrence wall time.
    pub occurrence_local_wall: String,
    /// Captured occurrence offset.
    pub occurrence_offset: String,
    /// Category ID.
    pub category_id: String,
    /// Money Space ID.
    pub money_space_id: String,
    /// Exact optional note.
    pub note: Option<String>,
    /// Required planning state.
    pub planned_status: Option<PlannedStatus>,
    /// Required purpose.
    pub purpose: Option<Purpose>,
}

impl std::fmt::Debug for CreateCandidate {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CreateCandidate([REDACTED])")
    }
}

/// Fully validated creation values.
#[derive(Clone, Eq, PartialEq)]
pub struct ValidatedCreate {
    /// Stable compose identifier.
    pub creation_id: CreationId,
    /// Direction.
    pub memo_type: MoneyMemoType,
    /// Exact amount.
    pub money: Money,
    /// Occurrence identity.
    pub occurrence: Occurrence,
    /// Active same-owner Category candidate ID.
    pub category_id: LabelId,
    /// Active same-owner Money Space candidate ID.
    pub money_space_id: LabelId,
    /// Exact accepted note; empty normalizes to null.
    pub note: Option<String>,
    /// Planning state.
    pub planned_status: PlannedStatus,
    /// Purpose.
    pub purpose: Purpose,
}

impl std::fmt::Debug for ValidatedCreate {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ValidatedCreate([REDACTED])")
    }
}

/// Validates all independent fields and returns every safe violation together.
pub fn validate_create(
    candidate: CreateCandidate,
    now: Timestamp,
) -> Result<ValidatedCreate, DomainError> {
    let mut violations = Vec::new();
    let mut creation_id = collect(
        CreationId::parse(&candidate.creation_id),
        "creationId",
        "required_uuid_v4",
        &mut violations,
    );
    if creation_id.is_some_and(|id| id.as_uuid().get_version_num() != 4) {
        violations.push(violation("creationId", "required_uuid_v4"));
        creation_id = None;
    }
    let memo_type = required(
        candidate.memo_type,
        "type",
        "required_enum",
        &mut violations,
    );
    let currency = collect(
        Currency::parse(&candidate.currency),
        "currency",
        "supported_currency",
        &mut violations,
    );
    let money = if amount_structure_valid(&candidate.amount) {
        currency.as_ref().and_then(|currency| {
            collect(
                Money::parse(&candidate.amount, currency.clone()),
                "amount",
                "positive_bounded_exact_decimal",
                &mut violations,
            )
        })
    } else {
        violations.push(violation("amount", "positive_bounded_exact_decimal"));
        None
    };
    let occurrence = parse_occurrence(&candidate, now, &mut violations);
    let category_id = collect(
        LabelId::parse(&candidate.category_id),
        "categoryId",
        "required_uuid",
        &mut violations,
    );
    let money_space_id = collect(
        LabelId::parse(&candidate.money_space_id),
        "moneySpaceId",
        "required_uuid",
        &mut violations,
    );
    let note = candidate.note.filter(|value| !value.is_empty());
    if note
        .as_ref()
        .is_some_and(|value| value.chars().count() > 1000)
    {
        violations.push(violation("note", "maximum_1000_characters"));
    }
    let planned_status = required(
        candidate.planned_status,
        "plannedStatus",
        "required_enum",
        &mut violations,
    );
    let purpose = required(
        candidate.purpose,
        "purpose",
        "required_enum",
        &mut violations,
    );
    if !violations.is_empty() {
        return Err(DomainError::validation(violations));
    }
    Ok(ValidatedCreate {
        creation_id: creation_id.ok_or_else(invariant)?,
        memo_type: memo_type.ok_or_else(invariant)?,
        money: money.ok_or_else(invariant)?,
        occurrence: occurrence.ok_or_else(invariant)?,
        category_id: category_id.ok_or_else(invariant)?,
        money_space_id: money_space_id.ok_or_else(invariant)?,
        note,
        planned_status: planned_status.ok_or_else(invariant)?,
        purpose: purpose.ok_or_else(invariant)?,
    })
}

fn parse_occurrence(
    candidate: &CreateCandidate,
    now: Timestamp,
    violations: &mut Vec<FieldViolation>,
) -> Option<Occurrence> {
    let result = (|| {
        let instant = Timestamp::parse_canonical(&candidate.occurrence_instant)?;
        let wall = LocalWall::parse(&candidate.occurrence_local_wall)?;
        let offset = UtcOffset::parse(&candidate.occurrence_offset)?;
        let occurrence = Occurrence::new(instant, wall, offset, ZoneResolution::Unique)?;
        occurrence.validate_range(now)?;
        Ok(occurrence)
    })();
    collect(
        result,
        "occurrence",
        "canonical_consistent_in_range",
        violations,
    )
}

fn amount_structure_valid(value: &str) -> bool {
    let (whole, fraction) = value.split_once('.').map_or((value, ""), |parts| parts);
    !whole.is_empty()
        && whole.bytes().all(|byte| byte.is_ascii_digit())
        && (whole.len() == 1 || !whole.starts_with('0'))
        && (!value.contains('.') || !fraction.is_empty())
        && fraction.bytes().all(|byte| byte.is_ascii_digit())
        && fraction.len() <= 4
        && whole.parse::<u64>().is_ok_and(|major| {
            major <= 999_999_999_999 && (major != 0 || fraction.bytes().any(|byte| byte != b'0'))
        })
}

fn collect<T>(
    result: Result<T, DomainError>,
    field: &'static str,
    rule: &'static str,
    violations: &mut Vec<FieldViolation>,
) -> Option<T> {
    if let Ok(value) = result {
        Some(value)
    } else {
        violations.push(violation(field, rule));
        None
    }
}

fn required<T>(
    value: Option<T>,
    field: &'static str,
    rule: &'static str,
    violations: &mut Vec<FieldViolation>,
) -> Option<T> {
    if value.is_none() {
        violations.push(violation(field, rule));
    }
    value
}

const fn violation(field: &'static str, rule: &'static str) -> FieldViolation {
    FieldViolation {
        field,
        rule,
        message: "Correct this field and submit again.",
        detector_id: None,
    }
}

fn invariant() -> DomainError {
    DomainError::retryable(
        crate::ErrorCode::DependencyUnavailable,
        "validated creation unavailable",
    )
}

/// Produces RFC 8785-compatible canonical JSON for this constrained document.
pub fn canonical_creation_document(
    owner: &OwnerId,
    value: &ValidatedCreate,
) -> Result<Vec<u8>, DomainError> {
    let mut amount = Map::new();
    amount.insert("minor".to_owned(), json!(value.money.minor().to_string()));
    amount.insert("scale".to_owned(), json!(value.money.currency().scale()));
    let mut occurrence = Map::new();
    occurrence.insert(
        "instant".to_owned(),
        json!(value.occurrence.instant().to_canonical()?),
    );
    occurrence.insert(
        "localWallTime".to_owned(),
        json!(value.occurrence.wall().canonical()),
    );
    occurrence.insert(
        "offsetMinutes".to_owned(),
        json!(value.occurrence.offset().minutes()),
    );
    let mut document = Map::new();
    document.insert("amount".to_owned(), Value::Object(amount));
    document.insert(
        "categoryId".to_owned(),
        json!(value.category_id.to_string()),
    );
    document.insert(
        "creationId".to_owned(),
        json!(value.creation_id.to_string()),
    );
    document.insert("currency".to_owned(), json!(value.money.currency().code()));
    document.insert(
        "moneySpaceId".to_owned(),
        json!(value.money_space_id.to_string()),
    );
    document.insert("note".to_owned(), json!(value.note));
    document.insert("occurrence".to_owned(), Value::Object(occurrence));
    document.insert("ownerId".to_owned(), json!(owner.as_str()));
    document.insert(
        "plannedStatus".to_owned(),
        json!(enum_planned(value.planned_status)),
    );
    document.insert("purpose".to_owned(), json!(enum_purpose(value.purpose)));
    document.insert("type".to_owned(), json!(enum_type(value.memo_type)));
    document.insert("v".to_owned(), json!(1));
    serde_json::to_vec(&Value::Object(document)).map_err(|_| invariant())
}

/// Stable persistence/API value.
#[must_use]
pub const fn enum_type(value: MoneyMemoType) -> &'static str {
    match value {
        MoneyMemoType::Income => "income",
        MoneyMemoType::Expense => "expense",
    }
}

/// Stable persistence/API value.
#[must_use]
pub const fn enum_planned(value: PlannedStatus) -> &'static str {
    match value {
        PlannedStatus::Planned => "planned",
        PlannedStatus::Unplanned => "unplanned",
    }
}

/// Stable persistence/API value.
#[must_use]
pub const fn enum_purpose(value: Purpose) -> &'static str {
    match value {
        Purpose::Personal => "personal",
        Purpose::Work => "work",
        Purpose::Mixed => "mixed",
    }
}
