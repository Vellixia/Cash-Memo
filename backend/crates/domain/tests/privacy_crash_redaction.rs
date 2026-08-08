//! Panic-path probes proving Pattern Set candidates and safe IDs never enter diagnostics.

use std::panic::{AssertUnwindSafe, catch_unwind};

use cashmemo_domain::privacy_pattern_v1::{PatternDecision, blocking_error, detect};

const FIXTURES: &[&str] = &[
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

const FORBIDDEN_DIAGNOSTIC_IDS: &[&str] = &[
    "B1_PAN_LUHN",
    "B2_IBAN_MOD97",
    "B3_LABELED_ACCOUNT",
    "B4_LABELED_ROUTING",
    "B5_LABELED_CARD_SECRET",
    "B6_LABELED_BANK_CREDENTIAL",
    "B7_LABELED_BANK_TOKEN",
    "B8_STATEMENT_PASTE",
    "B9_LABELED_GOV_ID",
];

#[test]
fn panic_before_during_and_after_every_blocking_detector_is_diagnostic_safe() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {
        eprintln!("cashmemo synthetic privacy panic captured");
    }));

    for fixture in FIXTURES {
        assert!(catch_unwind(|| panic!("cashmemo synthetic before probe")).is_err());
        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                let decision = detect(fixture);
                std::hint::black_box(decision);
                panic!("cashmemo synthetic during probe");
            }))
            .is_err()
        );

        let PatternDecision::Block(detector) = detect(fixture) else {
            panic!("blocking fixture required")
        };
        let decision_debug = format!("{:?}", PatternDecision::Block(detector));
        let detector_debug = format!("{detector:?}");
        let error_debug = format!("{:?}", blocking_error("note", detector));
        assert_diagnostic_safe(fixture, &decision_debug);
        assert_diagnostic_safe(fixture, &detector_debug);
        assert_diagnostic_safe(fixture, &error_debug);

        assert!(
            catch_unwind(AssertUnwindSafe(|| {
                let safe_error = blocking_error("note", detector);
                std::hint::black_box(safe_error);
                panic!("cashmemo synthetic after probe");
            }))
            .is_err()
        );
    }

    std::panic::set_hook(previous_hook);
    println!("privacy crash probes passed");
}

fn assert_diagnostic_safe(candidate: &str, rendered: &str) {
    assert!(!rendered.contains(candidate));
    for identifier in FORBIDDEN_DIAGNOSTIC_IDS {
        assert!(!rendered.contains(identifier));
    }
}
