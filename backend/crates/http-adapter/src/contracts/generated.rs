//! Reviewed Rust binding for Feature 001 `OpenAPI` 3.1 schemas.
#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

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
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum OccurrenceEdit {
    PreserveOffset {
        local_wall_time: String,
    },
    ChangeOffset {
        local_wall_time: String,
        utc_offset: String,
        confirmation: String,
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
    pub currency_change_confirmation: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct LabelReference {
    pub id: String,
    pub name: String,
    pub state: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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
    pub note: Option<String>,
    pub planned_status: PlannedStatus,
    pub purpose: Purpose,
    pub lifecycle_status: LifecycleStatus,
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
    pub lifecycle_status: Option<LifecycleStatus>,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldError {
    pub field: String,
    pub rule: String,
    pub message: String,
    pub detector_id: Option<SafeDetectorId>,
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
    pub current: Option<serde_json::Value>,
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
