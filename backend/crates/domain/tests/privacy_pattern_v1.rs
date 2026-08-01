//! Exact server Pattern Set v1 detector and privacy-error construction tests.

use cashmemo_domain::ErrorCode;
use cashmemo_domain::privacy_pattern_v1::{
    PatternDecision, WarningDetector, detect, validate_registry,
};

#[test]
fn checked_in_registry_and_every_blocking_class_are_stable() {
    assert!(validate_registry().is_ok());
    let fixtures = [
        "4111 1111 1111 1111",
        "GB82 WEST 1234 5698 7654 32",
        "account number: ABC123456",
        "routing number 111000025",
        "CVV 123",
        "bank password: hunter22",
        "bank access token: abcdefgh",
        "bank statement\naccount number\nopening balance\n2026-01-01 10\n2026-01-02 20\n2026-01-03 30",
        "SSN 123-45-6789",
    ];
    for (index, fixture) in fixtures.iter().enumerate() {
        let PatternDecision::Block(detector) = detect(fixture) else {
            panic!("expected blocking fixture")
        };
        assert!(detector.safe_id().starts_with(&format!("B{}", index + 1)));
    }
}

#[test]
fn warning_only_and_unicode_preprocessing_are_deterministic() {
    assert_eq!(
        detect("Discuss bank account policy"),
        PatternDecision::Warn(WarningDetector::W1BankingContext)
    );
    assert_eq!(
        detect("reference １２３４５６７"),
        PatternDecision::Warn(WarningDetector::W2UnlabeledLongNumber)
    );
    assert_eq!(
        detect("bank statement example"),
        PatternDecision::Warn(WarningDetector::W3StatementHeader)
    );
    assert_eq!(detect("ordinary lunch"), PatternDecision::Clear);
}

#[test]
fn blocking_error_has_only_safe_static_fields() {
    let PatternDecision::Block(detector) = detect("4111111111111111") else {
        panic!("expected blocking fixture")
    };
    let error = cashmemo_domain::privacy_pattern_v1::blocking_error("note", detector);
    assert_eq!(error.code, ErrorCode::PrivacyInputRejected);
    let encoded = serde_json::to_string(&error).unwrap_or_else(|_| panic!("serialization failed"));
    assert!(!encoded.contains("4111"));
    assert!(!encoded.contains("candidate"));
    assert!(!encoded.contains("normalized"));
}
