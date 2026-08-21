use chrono::{TimeZone, Utc};
use cashmemo_api::receipts::{DeletionReceipt, canonical_receipt_bytes, receipt_object_key};

#[test]
fn receipt_key_and_canonical_payload_are_stable_across_retries() {
    let receipt = DeletionReceipt::new(
        [0xab; 32],
        Utc.with_ymd_and_hms(2026, 8, 21, 12, 0, 0).unwrap(),
        7,
    );

    assert_eq!(
        receipt_object_key("anti-resurrection/", &receipt),
        "anti-resurrection/v7/abababababababababababababababababababababababababababababababab.json"
    );
    assert_eq!(
        canonical_receipt_bytes(&receipt).unwrap(),
        br#"{"hmac_user_id":"abababababababababababababababababababababababababababababababab","purged_at":"2026-08-21T12:00:00Z","key_version":7}"#
    );
}
