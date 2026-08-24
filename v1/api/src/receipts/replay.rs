use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use super::{
    DeletionReceipt, DeletionReceiptReader, ReceiptError, ReceiptObject, canonical_receipt_bytes,
    hmac_user_id, receipt_object_key,
};

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
    let objects = receipt_store
        .list_receipts()
        .await
        .map_err(map_receipt_error)?;
    let mut summary = ReplaySummary {
        receipts_scanned: objects.len() as u64,
        ..ReplaySummary::default()
    };
    let mut receipts = Vec::with_capacity(objects.len());
    for object in objects {
        match parse_receipt(&object, hmac_keyring) {
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
        for user_id in &user_ids {
            for (_, key) in hmac_keyring {
                let candidate =
                    hmac_user_id(key, *user_id).map_err(|_| ReplayError::Configuration)?;
                if candidate == receipt.hmac_user_id {
                    matches.insert(*user_id);
                }
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

fn parse_receipt(object: &ReceiptObject, keyring: &[(u32, Vec<u8>)]) -> Option<DeletionReceipt> {
    let wire: ReceiptWire = serde_json::from_slice(&object.body).ok()?;
    let hmac_user_id = decode_hmac(&wire.hmac_user_id)?;
    let purged_at = DateTime::parse_from_rfc3339(&wire.purged_at)
        .ok()?
        .with_timezone(&Utc);
    if !keyring
        .iter()
        .any(|(version, _)| *version == wire.key_version)
    {
        return None;
    }
    let receipt = DeletionReceipt::new(hmac_user_id, purged_at, wire.key_version);
    let canonical = canonical_receipt_bytes(&receipt).ok()?;
    (canonical == object.body && receipt_object_key_from_object(&receipt, &object.key))
        .then_some(receipt)
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

fn map_receipt_error(error: ReceiptError) -> ReplayError {
    match error {
        ReceiptError::Configuration => ReplayError::Configuration,
        ReceiptError::DivergentObject | ReceiptError::Storage => ReplayError::Storage,
    }
}
