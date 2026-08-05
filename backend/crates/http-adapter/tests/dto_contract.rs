//! Structural drift tests for the reviewed Rust `OpenAPI` binding.

use cashmemo_http_adapter::contracts::generated::{
    ErrorResponse, MoneyMemo, MoneyMemoEditRequest, MoneyMemoQuery, OccurrenceEdit,
};
use serde_json::{Value, json};

fn memo() -> Value {
    json!({
        "id": "f5b77e8f-ae9a-466e-8df4-b0079825f46e",
        "type": "expense",
        "amount": "42.50",
        "currency": "USD",
        "amountMinorUnitScale": 2,
        "occurrence": {
            "instant": "2026-07-30T12:15:00.000000Z",
            "localWallTime": "2026-07-30T19:15:00.000000",
            "utcOffset": "+07:00"
        },
        "category": {
            "id": "66ff6d25-01b0-4442-a9fe-0c4fef1f0605",
            "name": "General",
            "state": "active"
        },
        "moneySpace": {
            "id": "9074bd6a-6959-463a-8a04-88a537d12d57",
            "name": "Personal",
            "state": "active"
        },
        "note": null,
        "plannedStatus": "unplanned",
        "purpose": "personal",
        "lifecycleStatus": "active",
        "purgeDeadline": null,
        "revision": 1,
        "createdAt": "2026-07-30T12:15:00.000000Z",
        "updatedAt": "2026-07-30T12:15:00.000000Z"
    })
}

#[test]
fn occurrence_edit_uses_camel_case_fields_and_exact_confirmations() {
    let valid = json!({
        "expectedRevision": 1,
        "type": "expense",
        "amount": "42.50",
        "currency": "USD",
        "currencyChangeConfirmation": "REDECLARE_AMOUNT_WITHOUT_CONVERSION",
        "occurrence": {
            "mode": "change_offset",
            "localWallTime": "2026-07-30T19:15:00.000000",
            "utcOffset": "+08:00",
            "confirmation": "PRESERVE_WALL_TIME_AND_MOVE_INSTANT"
        },
        "categoryId": "66ff6d25-01b0-4442-a9fe-0c4fef1f0605",
        "moneySpaceId": "9074bd6a-6959-463a-8a04-88a537d12d57",
        "note": null,
        "plannedStatus": "unplanned",
        "purpose": "personal"
    });
    let parsed: MoneyMemoEditRequest =
        serde_json::from_value(valid.clone()).unwrap_or_else(|_| panic!("valid DTO rejected"));
    assert!(matches!(
        parsed.occurrence,
        OccurrenceEdit::ChangeOffset { .. }
    ));

    let mut snake = valid.clone();
    snake["occurrence"]["local_wall_time"] = snake["occurrence"]["localWallTime"].take();
    assert!(serde_json::from_value::<MoneyMemoEditRequest>(snake).is_err());

    let mut arbitrary = valid;
    arbitrary["occurrence"]["confirmation"] = json!("yes");
    assert!(serde_json::from_value::<MoneyMemoEditRequest>(arbitrary).is_err());
}

#[test]
fn query_and_closed_objects_match_openapi_shape() {
    assert!(
        serde_json::from_value::<MoneyMemoQuery>(json!({
            "lifecycleStatus": "pending_deletion"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<MoneyMemoQuery>(json!({
            "lifecycleStatus": "active"
        }))
        .is_ok()
    );

    let mut extra = memo();
    extra["internalFingerprint"] = json!("forbidden");
    assert!(serde_json::from_value::<MoneyMemo>(extra).is_err());
}

#[test]
fn response_required_nullable_and_typed_current_fields_are_enforced() {
    let mut missing_deadline = memo();
    missing_deadline
        .as_object_mut()
        .unwrap_or_else(|| panic!("memo object unavailable"))
        .remove("purgeDeadline");
    assert!(serde_json::from_value::<MoneyMemo>(missing_deadline).is_err());

    let mut missing_note = memo();
    missing_note
        .as_object_mut()
        .unwrap_or_else(|| panic!("memo object unavailable"))
        .remove("note");
    assert!(serde_json::from_value::<MoneyMemo>(missing_note).is_err());

    assert!(
        serde_json::from_value::<ErrorResponse>(json!({
            "code": "REVISION_CONFLICT",
            "message": "resource changed",
            "requestId": "2e252b21-f068-468a-9099-5ed22e125fb8",
            "retryable": false,
            "current": { "arbitrary": true }
        }))
        .is_err()
    );
}
