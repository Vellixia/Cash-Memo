//! Per-memo key generation, verification, and rotation tests.

use cashmemo_application::creation_fingerprint::{CreationFingerprint, FingerprintEnvelope};
use cashmemo_application::keyring::{KekKeyring, RuntimeKek};
use cashmemo_domain::{ErrorCode, OwnerId};

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

fn keyring(active: &str) -> KekKeyring {
    must(KekKeyring::new(
        active,
        vec![
            must(RuntimeKek::new("kek-2026-a", [0x11; 32])),
            must(RuntimeKek::new("kek-2026-b", [0x22; 32])),
        ],
    ))
}

#[test]
fn random_per_memo_keys_prevent_offline_confirmation() {
    let ring = keyring("kek-2026-a");
    let owner = must(OwnerId::parse_authenticated_account("owner_a"));
    let canonical = br#"{"amount":{"minor":"100","scale":2}}"#;
    let first = must(CreationFingerprint::create(
        &ring,
        &owner,
        "creation-a",
        canonical,
    ));
    let second = must(CreationFingerprint::create(
        &ring,
        &owner,
        "creation-b",
        canonical,
    ));
    assert_ne!(first.mac_hex, second.mac_hex);
    assert_ne!(first.wrapped_key_ciphertext, second.wrapped_key_ciphertext);
    assert!(must(CreationFingerprint::verify(
        &ring,
        &owner,
        "creation-a",
        canonical,
        &first
    )));
    assert!(!must(CreationFingerprint::verify(
        &ring,
        &owner,
        "creation-a",
        b"guess",
        &first
    )));
}

#[test]
fn rewrap_rotation_preserves_immutable_mac_and_verification() {
    let old = keyring("kek-2026-a");
    let new = keyring("kek-2026-b");
    let owner = must(OwnerId::parse_authenticated_account("owner_a"));
    let canonical = b"canonical";
    let original = must(CreationFingerprint::create(
        &old,
        &owner,
        "creation-a",
        canonical,
    ));
    let rotated = must(CreationFingerprint::rewrap(
        &old,
        &new,
        &owner,
        "creation-a",
        &original,
    ));
    assert_eq!(original.mac_hex, rotated.mac_hex);
    assert_eq!(rotated.kek_id, "kek-2026-b");
    assert!(must(CreationFingerprint::verify(
        &new,
        &owner,
        "creation-a",
        canonical,
        &rotated
    )));
}

#[test]
fn missing_or_tampered_keys_fail_closed() {
    let ring = keyring("kek-2026-a");
    let owner = must(OwnerId::parse_authenticated_account("owner_a"));
    let mut envelope = must(CreationFingerprint::create(
        &ring,
        &owner,
        "creation-a",
        b"canonical",
    ));
    envelope.kek_id = "retired".to_owned();
    let error = must_error(CreationFingerprint::verify(
        &ring,
        &owner,
        "creation-a",
        b"canonical",
        &envelope,
    ));
    assert_eq!(error.code, ErrorCode::IdempotencyVerificationUnavailable);

    let mut tampered: FingerprintEnvelope = must(CreationFingerprint::create(
        &ring,
        &owner,
        "creation-a",
        b"canonical",
    ));
    tampered.wrapped_key_ciphertext.push('A');
    assert_eq!(
        must_error(CreationFingerprint::verify(
            &ring,
            &owner,
            "creation-a",
            b"canonical",
            &tampered,
        ))
        .code,
        ErrorCode::IdempotencyVerificationUnavailable
    );
    assert!(ring.retire("kek-2026-a", 1).is_err());
}
