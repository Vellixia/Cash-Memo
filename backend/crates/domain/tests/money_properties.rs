//! Exact money property and boundary tests.

use cashmemo_domain::money::{Currency, Money};
use proptest::prelude::*;

fn currency(code: &str) -> Currency {
    let Ok(value) = Currency::parse(code) else {
        panic!("test registry currency missing")
    };
    value
}

#[test]
fn exact_scales_and_no_rounding() {
    for (code, valid, too_precise, expected) in [
        ("JPY", "42", "42.1", "42"),
        ("USD", "42.5", "42.501", "42.50"),
        ("BHD", "42.500", "42.5001", "42.500"),
        ("CLF", "42.5000", "42.50001", "42.5000"),
    ] {
        let parsed = Money::parse(valid, currency(code));
        let Ok(parsed) = parsed else {
            panic!("valid exact money rejected")
        };
        assert_eq!(parsed.decimal(), expected);
        assert!(Money::parse(too_precise, currency(code)).is_err());
    }
}

#[test]
fn exact_maximum_and_one_minor_over() {
    let maximum = Money::parse("999999999999.99", currency("USD"));
    let Ok(maximum) = maximum else {
        panic!("exact maximum rejected")
    };
    assert_eq!(maximum.minor(), 99_999_999_999_999);
    assert!(Money::parse("1000000000000", currency("USD")).is_err());
}

#[test]
fn malformed_and_nonpositive_forms_are_rejected() {
    for value in [
        "", "0", "0.00", "-1", "+1", "1,000", "1e2", "01", ".5", "1.", "1..0",
    ] {
        assert!(
            Money::parse(value, currency("USD")).is_err(),
            "accepted malformed form"
        );
    }
}

proptest! {
    #[test]
    fn decimal_round_trip_is_exact(major in 0_u64..1_000_000, cents in 0_u64..100) {
        let decimal = format!("{major}.{cents:02}");
        if major == 0 && cents == 0 {
            prop_assert!(Money::parse(&decimal, currency("USD")).is_err());
        } else {
            let parsed = Money::parse(&decimal, currency("USD"));
            prop_assert!(parsed.is_ok());
            if let Ok(parsed) = parsed {
                prop_assert_eq!(parsed.decimal(), decimal);
            }
        }
    }
}
