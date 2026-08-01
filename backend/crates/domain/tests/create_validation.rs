//! Aggregated safe creation validation contract.

use cashmemo_domain::create::{CreateCandidate, validate_create};
use cashmemo_domain::money_memo::{MoneyMemoType, PlannedStatus, Purpose};
use cashmemo_domain::{ErrorCode, Timestamp};

fn must<T, E>(result: Result<T, E>) -> T {
    let Ok(value) = result else {
        panic!("expected success")
    };
    value
}

fn must_error<T, E>(result: Result<T, E>) -> E {
    let Err(error) = result else {
        panic!("expected failure")
    };
    error
}

fn valid_candidate() -> CreateCandidate {
    CreateCandidate {
        creation_id: "b4f82dc9-118f-45e4-bbe7-d742f921589f".to_owned(),
        memo_type: Some(MoneyMemoType::Expense),
        amount: "42.50".to_owned(),
        currency: "USD".to_owned(),
        occurrence_instant: "2026-01-01T00:00:00.000000Z".to_owned(),
        occurrence_local_wall: "2026-01-01T07:00:00.000000".to_owned(),
        occurrence_offset: "+07:00".to_owned(),
        category_id: "66ff6d25-01b0-4442-a9fe-0c4fef1f0605".to_owned(),
        money_space_id: "9074bd6a-6959-463a-8a04-88a537d12d57".to_owned(),
        note: None,
        planned_status: Some(PlannedStatus::Unplanned),
        purpose: Some(Purpose::Personal),
    }
}

#[test]
fn valid_create_preserves_exact_money_and_occurrence() {
    let value = must(validate_create(
        valid_candidate(),
        must(Timestamp::parse_canonical("2026-01-01T00:00:00.000000Z")),
    ));
    assert_eq!(value.money.decimal(), "42.50");
    assert_eq!(value.occurrence.offset().canonical(), "+07:00");
    assert_eq!(value.note, None);
}

#[test]
fn invalid_create_aggregates_safe_field_and_rule_only_errors() {
    let mut candidate = valid_candidate();
    candidate.memo_type = None;
    candidate.amount = "-1,000".to_owned();
    candidate.currency = "ZZZ".to_owned();
    candidate.occurrence_instant = "2037-01-01T00:00:00.000000Z".to_owned();
    candidate.occurrence_local_wall = "2037-01-01T07:00:00.000000".to_owned();
    candidate.category_id.clear();
    candidate.money_space_id = "not-an-id".to_owned();
    candidate.note = Some("x".repeat(1001));
    candidate.planned_status = None;
    candidate.purpose = None;

    let error = must_error(validate_create(
        candidate,
        must(Timestamp::parse_canonical("2026-01-01T00:00:00.000000Z")),
    ));
    assert_eq!(error.code, ErrorCode::ValidationFailed);
    let fields = error
        .violations
        .iter()
        .map(|violation| violation.field)
        .collect::<Vec<_>>();
    for expected in [
        "type",
        "amount",
        "currency",
        "occurrence",
        "categoryId",
        "moneySpaceId",
        "note",
        "plannedStatus",
        "purpose",
    ] {
        assert!(fields.contains(&expected), "missing {expected}");
    }
    let debug = format!("{error:?}");
    assert!(!debug.contains("-1,000"));
    assert!(!debug.contains("ZZZ"));
}

#[test]
fn amount_boundaries_and_currency_precision_are_exact() {
    let now = must(Timestamp::parse_canonical("2026-01-01T00:00:00.000000Z"));
    for amount in ["0", "1000000000000", "1.001", "+1", "1e2", "1,00"] {
        let mut candidate = valid_candidate();
        candidate.amount = amount.to_owned();
        assert!(
            validate_create(candidate, now).is_err(),
            "accepted {amount}"
        );
    }
    let mut maximum = valid_candidate();
    maximum.amount = "999999999999.99".to_owned();
    assert!(validate_create(maximum, now).is_ok());
}
