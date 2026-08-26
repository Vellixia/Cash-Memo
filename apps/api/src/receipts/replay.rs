use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use super::{DeletionReceipt, DeletionReceiptReader, canonical_receipt_bytes, receipt_object_key};

/// Unsigned operational result. It contains no identifier, receipt payload, or key material.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ReplaySummary {
    pub receipts_scanned: u64,
    pub users_purged: u64,
    pub unreadable_receipts: u64,
    pub unprocessed_matches: u64,
}

impl ReplaySummary {
    pub fn ready(self) -> bool {
        self.unreadable_receipts == 0 && self.unprocessed_matches == 0
    }
}

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("receipt replay configuration is invalid")]
    Configuration,
    #[error("receipt replay storage operation failed")]
    Storage,
    #[error("restored database operation failed")]
    Database,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReceiptWire {
    hmac_user_id: String,
    purged_at: String,
    key_version: u32,
}

/// Deletes only accounts in an isolated restored database that match verified receipts.
/// Any unreadable/divergent receipt prevents every deletion in this replay pass.
pub async fn replay_deletion_receipts(
    restored_pool: &PgPool,
    receipt_store: &dyn DeletionReceiptReader,
    hmac_keyring: &[(u32, Vec<u8>)],
) -> Result<ReplaySummary, ReplayError> {
    validate_keyring(hmac_keyring)?;
    let keys = match receipt_store.list_receipt_keys().await {
        Ok(keys) => keys,
        Err(_) => {
            return Ok(ReplaySummary {
                unreadable_receipts: 1,
                ..ReplaySummary::default()
            });
        }
    };
    let mut summary = ReplaySummary {
        receipts_scanned: keys.len() as u64,
        ..ReplaySummary::default()
    };
    let mut receipts = Vec::with_capacity(keys.len());
    for key in keys {
        match receipt_store
            .read_receipt(&key)
            .await
            .ok()
            .and_then(|body| parse_receipt(&key, &body, hmac_keyring))
        {
            Some(receipt) => receipts.push(receipt),
            None => summary.unreadable_receipts += 1,
        }
    }
    if summary.unreadable_receipts != 0 {
        return Ok(summary);
    }

    let user_ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM users")
        .fetch_all(restored_pool)
        .await
        .map_err(|_| ReplayError::Database)?;
    let mut matches = BTreeSet::new();
    for receipt in receipts {
        let key =
            key_for_version(hmac_keyring, receipt.key_version).ok_or(ReplayError::Configuration)?;
        for user_id in &user_ids {
            if verify_user_id_hmac(key, *user_id, &receipt.hmac_user_id)? {
                matches.insert(*user_id);
            }
        }
    }
    let mut tx = restored_pool
        .begin()
        .await
        .map_err(|_| ReplayError::Database)?;
    for user_id in &matches {
        match sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await
        {
            Ok(result) if result.rows_affected() == 1 => summary.users_purged += 1,
            Ok(_) | Err(_) => {
                tx.rollback().await.map_err(|_| ReplayError::Database)?;
                summary.users_purged = 0;
                summary.unprocessed_matches = matches.len() as u64;
                return Ok(summary);
            }
        }
    }
    tx.commit().await.map_err(|_| ReplayError::Database)?;
    Ok(summary)
}

fn validate_keyring(hmac_keyring: &[(u32, Vec<u8>)]) -> Result<(), ReplayError> {
    let mut versions = BTreeSet::new();
    if hmac_keyring.is_empty()
        || hmac_keyring
            .iter()
            .any(|(version, key)| *version == 0 || key.len() < 32 || !versions.insert(*version))
    {
        return Err(ReplayError::Configuration);
    }
    Ok(())
}

fn key_for_version(keyring: &[(u32, Vec<u8>)], key_version: u32) -> Option<&[u8]> {
    keyring
        .iter()
        .find(|(version, _)| *version == key_version)
        .map(|(_, key)| key.as_slice())
}

fn verify_user_id_hmac(
    key: &[u8],
    user_id: Uuid,
    expected: &[u8; 32],
) -> Result<bool, ReplayError> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| ReplayError::Configuration)?;
    mac.update(user_id.as_bytes());
    Ok(mac.verify_slice(expected).is_ok())
}

fn parse_receipt(key: &str, body: &[u8], keyring: &[(u32, Vec<u8>)]) -> Option<DeletionReceipt> {
    let wire: ReceiptWire = serde_json::from_slice(body).ok()?;
    let hmac_user_id = decode_hmac(&wire.hmac_user_id)?;
    let purged_at = DateTime::parse_from_rfc3339(&wire.purged_at)
        .ok()?
        .with_timezone(&Utc);
    key_for_version(keyring, wire.key_version)?;
    let receipt = DeletionReceipt::new(hmac_user_id, purged_at, wire.key_version);
    let canonical = canonical_receipt_bytes(&receipt).ok()?;
    (canonical == body && receipt_object_key_from_object(&receipt, key)).then_some(receipt)
}

fn receipt_object_key_from_object(receipt: &DeletionReceipt, actual_key: &str) -> bool {
    let Some((prefix, _)) = actual_key.rsplit_once("/v") else {
        return false;
    };
    receipt_object_key(prefix, receipt) == actual_key
}

fn decode_hmac(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, slot) in decoded.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(decoded)
}

#[cfg(test)]
mod tests {
    use super::verify_user_id_hmac;
    use uuid::Uuid;

    const USER_ID: Uuid = Uuid::from_u128(0x00112233445566778899aabbccddeeff);
    const V1_TAG: [u8; 32] = [
        0xba, 0xbc, 0x4c, 0x3c, 0x25, 0x5e, 0x58, 0x0c, 0x1a, 0x4d, 0xb6, 0x2c, 0x89, 0xe5, 0x20,
        0x2e, 0x8c, 0xe0, 0xa9, 0x14, 0x7f, 0xc0, 0x6f, 0xd7, 0x2f, 0xcf, 0x3b, 0x7d, 0x67, 0x8f,
        0x1f, 0xc9,
    ];
    const V2_TAG: [u8; 32] = [
        0x91, 0xda, 0x93, 0x68, 0x10, 0xa3, 0xd9, 0x01, 0x54, 0x9b, 0x60, 0x81, 0x6d, 0xb6, 0x29,
        0x43, 0x30, 0xd1, 0x45, 0xd8, 0xd0, 0x0e, 0x64, 0xb3, 0x86, 0xbf, 0x8a, 0xba, 0xbf, 0xa5,
        0xe2, 0x67,
    ];

    #[test]
    fn verifier_accepts_valid_tag_for_declared_key() {
        assert!(verify_user_id_hmac(&[1; 32], USER_ID, &V1_TAG).unwrap());
    }

    #[test]
    fn verifier_rejects_modified_tag() {
        let mut modified = V1_TAG;
        modified[31] ^= 1;

        assert!(!verify_user_id_hmac(&[1; 32], USER_ID, &modified).unwrap());
    }

    #[test]
    fn verifier_rejects_tag_from_other_key_version() {
        assert!(!verify_user_id_hmac(&[1; 32], USER_ID, &V2_TAG).unwrap());
    }
}
