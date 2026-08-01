//! Stable safe error contract tests.

use cashmemo_domain::error::{DomainError, ErrorCode, FieldViolation};
use cashmemo_http_adapter::contracts::generated::{ErrorCode as HttpCode, SafeDetectorId};
use cashmemo_http_adapter::contracts::mapping::{http_status, map_error};

#[test]
fn privacy_rejection_is_http_422_with_allowlisted_id_only() {
    let error = DomainError {
        code: ErrorCode::PrivacyInputRejected,
        message: "free-text input must be corrected before submission",
        retryable: false,
        violations: vec![FieldViolation {
            field: "note",
            rule: "prohibited_data_pattern",
            message: "remove the prohibited value and retry",
            detector_id: Some("B1_PAN_LUHN"),
        }],
        existing_memo_id: None,
    };
    let response = map_error(&error, "0198a71a-3d39-7d4b-8eab-0e3c0f17be28".to_owned());
    assert_eq!(http_status(error.code), 422);
    assert_eq!(response.code, HttpCode::PrivacyInputRejected);
    assert_eq!(response.field_errors.len(), 1);
    assert_eq!(
        response.field_errors[0].detector_id,
        Some(SafeDetectorId::B1PanLuhn)
    );
    let encoded = serde_json::to_string(&response);
    let Ok(encoded) = encoded else {
        panic!("safe error failed to serialize")
    };
    for forbidden in [
        "candidate",
        "normalized",
        "matchOffset",
        "ownerId",
        "amount",
    ] {
        assert!(!encoded.contains(forbidden));
    }
}

#[test]
fn unknown_detector_identifier_is_dropped() {
    let error = DomainError {
        code: ErrorCode::PrivacyInputRejected,
        message: "free-text input must be corrected before submission",
        retryable: false,
        violations: vec![FieldViolation {
            field: "note",
            rule: "prohibited_data_pattern",
            message: "remove the prohibited value and retry",
            detector_id: Some("UNPUBLISHED_VALUE"),
        }],
        existing_memo_id: None,
    };
    let response = map_error(&error, "0198a71a-3d39-7d4b-8eab-0e3c0f17be28".to_owned());
    assert_eq!(response.field_errors[0].detector_id, None);
}

#[test]
fn stable_status_mapping_covers_fail_closed_codes() {
    assert_eq!(http_status(ErrorCode::AuthRequired), 401);
    assert_eq!(http_status(ErrorCode::NotFound), 404);
    assert_eq!(http_status(ErrorCode::ValidationFailed), 422);
    assert_eq!(http_status(ErrorCode::CreationIdentifierConflict), 409);
    assert_eq!(
        http_status(ErrorCode::IdempotencyVerificationUnavailable),
        503
    );
}
