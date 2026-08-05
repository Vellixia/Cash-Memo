//! Reviewed Rust binding for Feature 001 `OpenAPI` 3.1 schemas.
#![allow(missing_docs)]

use serde::{Deserialize, Deserializer, Serialize};

/// Reviewed source-contract digest. Drift gate requires explicit DTO review on contract changes.
pub const OPENAPI_SHA256: &str =
    "189764b52354b1c793a23f1fe5d1a2f7223e4d925de2d324ef1fb7448fe45975";

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthenticatedSession {
    pub account_id: String,
}

impl std::fmt::Debug for AuthenticatedSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("AuthenticatedSession([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MoneyMemoType {
    Income,
    Expense,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannedStatus {
    Planned,
    Unplanned,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Purpose {
    Personal,
    Work,
    Mixed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleStatus {
    Active,
    Archived,
    PendingDeletion,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LabelKind {
    Category,
    MoneySpace,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LabelState {
    Active,
    Deactivated,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CurrencyChangeConfirmation {
    #[serde(rename = "REDECLARE_AMOUNT_WITHOUT_CONVERSION")]
    RedeclareAmountWithoutConversion,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum OffsetChangeConfirmation {
    #[serde(rename = "PRESERVE_WALL_TIME_AND_MOVE_INSTANT")]
    PreserveWallTimeAndMoveInstant,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryLifecycleStatus {
    Active,
    Archived,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OccurrenceCreate {
    pub instant: String,
    pub local_wall_time: String,
    pub utc_offset: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoneyMemoCreateRequest {
    pub creation_id: String,
    #[serde(rename = "type")]
    pub memo_type: MoneyMemoType,
    pub amount: String,
    pub currency: String,
    pub occurrence: OccurrenceCreate,
    pub category_id: String,
    pub money_space_id: String,
    #[serde(default)]
    pub note: Option<String>,
    pub planned_status: PlannedStatus,
    pub purpose: Purpose,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "mode",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum OccurrenceEdit {
    PreserveOffset {
        local_wall_time: String,
    },
    ChangeOffset {
        local_wall_time: String,
        utc_offset: String,
        confirmation: OffsetChangeConfirmation,
    },
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoneyMemoEditRequest {
    pub expected_revision: i64,
    #[serde(rename = "type")]
    pub memo_type: MoneyMemoType,
    pub amount: String,
    pub currency: String,
    pub currency_change_confirmation: Option<CurrencyChangeConfirmation>,
    pub occurrence: OccurrenceEdit,
    pub category_id: String,
    pub money_space_id: String,
    pub note: Option<String>,
    pub planned_status: PlannedStatus,
    pub purpose: Purpose,
}

impl std::fmt::Debug for MoneyMemoEditRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MoneyMemoEditRequest([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevisionRequest {
    pub expected_revision: i64,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabelReference {
    pub id: String,
    pub name: String,
    pub state: LabelState,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoneyMemo {
    pub id: String,
    #[serde(rename = "type")]
    pub memo_type: MoneyMemoType,
    pub amount: String,
    pub currency: String,
    pub amount_minor_unit_scale: u8,
    pub occurrence: OccurrenceCreate,
    pub category: LabelReference,
    pub money_space: LabelReference,
    #[serde(deserialize_with = "required_nullable")]
    pub note: Option<String>,
    pub planned_status: PlannedStatus,
    pub purpose: Purpose,
    pub lifecycle_status: LifecycleStatus,
    #[serde(deserialize_with = "required_nullable")]
    pub purge_deadline: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageRequest {
    pub page_size: Option<u16>,
    pub page_position: Option<String>,
    pub expected_result_set_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoneyMemoPage {
    pub items: Vec<MoneyMemo>,
    #[serde(deserialize_with = "required_nullable")]
    pub next_page_position: Option<String>,
    pub result_set_version: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoneyMemoQuery {
    pub page_size: Option<u16>,
    pub page_position: Option<String>,
    pub expected_result_set_version: Option<String>,
    pub search: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    #[serde(rename = "type")]
    pub memo_type: Option<MoneyMemoType>,
    pub currency: Option<String>,
    pub category_id: Option<String>,
    pub money_space_id: Option<String>,
    pub planned_status: Option<PlannedStatus>,
    pub purpose: Option<Purpose>,
    pub lifecycle_status: Option<QueryLifecycleStatus>,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Label {
    pub id: String,
    pub kind: LabelKind,
    pub name: String,
    pub state: LabelState,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

impl std::fmt::Debug for Label {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Label")
            .field("kind", &self.kind)
            .field("state", &self.state)
            .field("revision", &self.revision)
            .finish_non_exhaustive()
    }
}

impl std::fmt::Debug for MoneyMemoCreateRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MoneyMemoCreateRequest([REDACTED])")
    }
}

impl std::fmt::Debug for MoneyMemo {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MoneyMemo")
            .field("lifecycle_status", &self.lifecycle_status)
            .field("revision", &self.revision)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    AuthRequired,
    NotFound,
    ValidationFailed,
    PrivacyInputRejected,
    CreationIdentifierConflict,
    RevisionConflict,
    CurrencyChangeConfirmationRequired,
    OffsetChangeConfirmationRequired,
    LabelNameConflict,
    LabelInUse,
    ExportInProgress,
    ExportConsistencyUnavailable,
    IdempotencyVerificationUnavailable,
    PurgeLedgerUnavailable,
    PagePositionInvalid,
    PagePositionExpired,
    PageSizeInvalid,
    ListChanged,
    DependencyUnavailable,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub enum SafeDetectorId {
    #[serde(rename = "B1_PAN_LUHN")]
    B1PanLuhn,
    #[serde(rename = "B2_IBAN_MOD97")]
    B2IbanMod97,
    #[serde(rename = "B3_LABELED_ACCOUNT")]
    B3LabeledAccount,
    #[serde(rename = "B4_LABELED_ROUTING")]
    B4LabeledRouting,
    #[serde(rename = "B5_LABELED_CARD_SECRET")]
    B5LabeledCardSecret,
    #[serde(rename = "B6_LABELED_BANK_CREDENTIAL")]
    B6LabeledBankCredential,
    #[serde(rename = "B7_LABELED_BANK_TOKEN")]
    B7LabeledBankToken,
    #[serde(rename = "B8_STATEMENT_PASTE")]
    B8StatementPaste,
    #[serde(rename = "B9_LABELED_GOV_ID")]
    B9LabeledGovId,
}

impl std::fmt::Debug for SafeDetectorId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SafeDetectorId([REDACTED])")
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldError {
    pub field: String,
    pub rule: String,
    pub message: String,
    pub detector_id: Option<SafeDetectorId>,
}

impl std::fmt::Debug for FieldError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FieldError")
            .field("field", &self.field)
            .field("rule", &self.rule)
            .field("message", &self.message)
            .field("has_detector_id", &self.detector_id.is_some())
            .finish()
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum CurrentResource {
    MoneyMemo(MoneyMemo),
    Label(Label),
}

impl std::fmt::Debug for CurrentResource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("CurrentResource([REDACTED])")
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorResponse {
    pub code: ErrorCode,
    pub message: String,
    pub request_id: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_errors: Vec<FieldError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<CurrentResource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_memo_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_required: Option<bool>,
}

impl std::fmt::Debug for ErrorResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ErrorResponse")
            .field("code", &self.code)
            .field("request_id", &"[REDACTED]")
            .field("retryable", &self.retryable)
            .finish_non_exhaustive()
    }
}
