//! Canonical immutable creation-document golden and property vectors.

use cashmemo_domain::create::{CreateCandidate, canonical_creation_document, validate_create};
use cashmemo_domain::money_memo::{MoneyMemoType, PlannedStatus, Purpose};
use cashmemo_domain::{OwnerId, Timestamp};
use proptest::prelude::*;

fn must<T, E>(result: Result<T, E>) -> T {
    let Ok(value) = result else {
        panic!("expected success")
    };
    value
}

fn candidate(note: Option<String>) -> CreateCandidate {
    CreateCandidate {
        creation_id: "b4f82dc9-118f-45e4-bbe7-d742f921589f".to_owned(),
        memo_type: Some(MoneyMemoType::Expense),
        amount: "42.50".to_owned(),
        currency: "USD".to_owned(),
        occurrence_instant: "2026-07-30T12:15:00.000000Z".to_owned(),
        occurrence_local_wall: "2026-07-30T19:15:00.000000".to_owned(),
        occurrence_offset: "+07:00".to_owned(),
        category_id: "66ff6d25-01b0-4442-a9fe-0c4fef1f0605".to_owned(),
        money_space_id: "9074bd6a-6959-463a-8a04-88a537d12d57".to_owned(),
        note,
        planned_status: Some(PlannedStatus::Unplanned),
        purpose: Some(Purpose::Personal),
    }
}

#[test]
fn canonical_document_matches_reviewed_golden_vector() {
    let validated = must(validate_create(
        candidate(Some("Café ☕".to_owned())),
        must(Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z")),
    ));
    let owner = must(OwnerId::parse_authenticated_account("owner_a"));
    let document = must(String::from_utf8(must(canonical_creation_document(
        &owner, &validated,
    ))));
    assert_eq!(
        document,
        "{\"amount\":{\"minor\":\"4250\",\"scale\":2},\"categoryId\":\"66ff6d25-01b0-4442-a9fe-0c4fef1f0605\",\"creationId\":\"b4f82dc9-118f-45e4-bbe7-d742f921589f\",\"currency\":\"USD\",\"moneySpaceId\":\"9074bd6a-6959-463a-8a04-88a537d12d57\",\"note\":\"Café ☕\",\"occurrence\":{\"instant\":\"2026-07-30T12:15:00.000000Z\",\"localWallTime\":\"2026-07-30T19:15:00.000000\",\"offsetMinutes\":420},\"ownerId\":\"owner_a\",\"plannedStatus\":\"unplanned\",\"purpose\":\"personal\",\"type\":\"expense\",\"v\":1}"
    );
}

#[test]
fn empty_and_omitted_note_canonicalize_to_null_but_unicode_is_preserved() {
    let now = must(Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z"));
    let owner = must(OwnerId::parse_authenticated_account("owner_a"));
    let omitted = must(validate_create(candidate(None), now));
    let empty = must(validate_create(candidate(Some(String::new())), now));
    assert_eq!(
        must(canonical_creation_document(&owner, &omitted)),
        must(canonical_creation_document(&owner, &empty))
    );
    let composed = must(validate_create(candidate(Some("é".to_owned())), now));
    let decomposed = must(validate_create(candidate(Some("e\u{301}".to_owned())), now));
    assert_ne!(
        must(canonical_creation_document(&owner, &composed)),
        must(canonical_creation_document(&owner, &decomposed))
    );
}

proptest! {
    #[test]
    fn canonicalization_is_deterministic(note in ".{0,64}") {
        let now = must(Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z"));
        let owner = must(OwnerId::parse_authenticated_account("owner_a"));
        let value = must(validate_create(candidate(Some(note)), now));
        prop_assert_eq!(
            must(canonical_creation_document(&owner, &value)),
            must(canonical_creation_document(&owner, &value))
        );
    }
}
