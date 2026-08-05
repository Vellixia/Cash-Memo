//! Exact server Pattern Set v1 detector and privacy-error construction tests.

use cashmemo_domain::ErrorCode;
use cashmemo_domain::privacy_pattern_v1::{
    BlockingDetector, PatternDecision, WarningDetector, detect, validate_registry,
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
    let debug = format!("{error:?}");
    assert!(!debug.contains("B1_PAN_LUHN"));
    assert!(!debug.contains("4111"));
}

#[test]
fn b8_requires_three_later_rows_with_amount_separate_from_date() {
    let header = "bank statement\naccount number\nopening balance";
    assert_ne!(
        detect(&format!(
            "2026-01-01 10\n2026-01-02 20\n2026-01-03 30\n{header}"
        )),
        PatternDecision::Block(
            cashmemo_domain::privacy_pattern_v1::BlockingDetector::B8StatementPaste
        )
    );
    assert_ne!(
        detect(&format!("{header}\n2026-01-01\n2026-01-02\n2026-01-03")),
        PatternDecision::Block(
            cashmemo_domain::privacy_pattern_v1::BlockingDetector::B8StatementPaste
        )
    );
    assert_eq!(
        detect(&format!(
            "{header}\n2026-01-01 10.00\n02/01/2026 20\n03-01-2026 30"
        )),
        PatternDecision::Block(
            cashmemo_domain::privacy_pattern_v1::BlockingDetector::B8StatementPaste
        )
    );
}

#[test]
fn complete_registry_labels_headers_phrases_and_boundaries_are_executed() {
    let registry: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../shared/privacy/pattern-set-v1.json"
    ))
    .unwrap_or_else(|_| panic!("registry unavailable"));
    let blocking = registry["blocking"]
        .as_array()
        .unwrap_or_else(|| panic!("blocking registry unavailable"));
    for entry in blocking {
        let id = entry["id"]
            .as_str()
            .unwrap_or_else(|| panic!("detector ID unavailable"));
        let Some(labels) = entry.get("labels").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for label in labels {
            let label = label
                .as_str()
                .unwrap_or_else(|| panic!("label unavailable"));
            let candidate = match (id, label) {
                ("B4_LABELED_ROUTING", "sort code" | "bsb") => "123456",
                ("B4_LABELED_ROUTING", _) => "111000025",
                ("B5_LABELED_CARD_SECRET", _) => "123",
                ("B6_LABELED_BANK_CREDENTIAL", _) => "hunter22",
                ("B7_LABELED_BANK_TOKEN", _) => "abcdefgh",
                ("B9_LABELED_GOV_ID", "ssn" | "social security number") => "123-45-6789",
                ("B9_LABELED_GOV_ID", "nik" | "nomor induk kependudukan") => "1234567890123450",
                ("B3_LABELED_ACCOUNT" | "B9_LABELED_GOV_ID", _) => "ABC123456",
                _ => continue,
            };
            let PatternDecision::Block(detector) = detect(&format!("{label}: {candidate}")) else {
                panic!("registry blocking fixture did not block")
            };
            assert_eq!(detector.safe_id(), id);
        }
    }

    let b8 = &blocking[7];
    for header in b8["headers"]
        .as_array()
        .unwrap_or_else(|| panic!("B8 headers unavailable"))
    {
        let header = header
            .as_str()
            .unwrap_or_else(|| panic!("B8 header unavailable"));
        assert_eq!(
            detect(&format!(
                "{header}\nopening balance\ncredit\n2026-01-01 10\n02/01/2026 20\n03-01-2026 30"
            )),
            PatternDecision::Block(BlockingDetector::B8StatementPaste)
        );
    }
    assert_eq!(detect("reference 12345"), PatternDecision::Clear);
    assert_eq!(
        detect("reference 123456"),
        PatternDecision::Warn(WarningDetector::W2UnlabeledLongNumber)
    );
    assert_eq!(
        detect(&format!("reference {}", "1".repeat(35))),
        PatternDecision::Clear
    );
}
