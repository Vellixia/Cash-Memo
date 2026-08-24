use async_trait::async_trait;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use thiserror::Error;
use uuid::Uuid;

pub mod replay;
#[cfg(feature = "s3-receipts")]
pub mod s3;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeletionReceipt {
    pub hmac_user_id: [u8; 32],
    pub purged_at: DateTime<Utc>,
    pub key_version: u32,
}

impl DeletionReceipt {
    pub fn new(hmac_user_id: [u8; 32], purged_at: DateTime<Utc>, key_version: u32) -> Self {
        Self {
            hmac_user_id,
            purged_at,
            key_version,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReceiptWrite {
    Created,
    AlreadyPresentIdentical,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ReceiptError {
    #[error("receipt object differs from the expected immutable payload")]
    DivergentObject,
    #[error("receipt storage operation failed")]
    Storage,
    #[error("receipt key configuration is invalid")]
    Configuration,
}

#[async_trait]
pub trait DeletionReceiptStore: Send + Sync {
    async fn put_receipt(&self, receipt: &DeletionReceipt) -> Result<ReceiptWrite, ReceiptError>;
}

/// Read-only receipt access used only by an isolated restore replay command.
#[async_trait]
pub trait DeletionReceiptReader: Send + Sync {
    async fn list_receipt_keys(&self) -> Result<Vec<String>, ReceiptError>;
    async fn read_receipt(&self, key: &str) -> Result<Vec<u8>, ReceiptError>;
}

pub fn hmac_user_id(key: &[u8], user_id: Uuid) -> Result<[u8; 32], ReceiptError> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| ReceiptError::Configuration)?;
    mac.update(user_id.as_bytes());
    Ok(mac.finalize().into_bytes().into())
}

pub fn receipt_object_key(prefix: &str, receipt: &DeletionReceipt) -> String {
    format!(
        "{}/v{}/{:x}.json",
        prefix.trim_end_matches('/'),
        receipt.key_version,
        Hex(&receipt.hmac_user_id)
    )
}

pub fn canonical_receipt_bytes(receipt: &DeletionReceipt) -> Result<Vec<u8>, serde_json::Error> {
    #[derive(Serialize)]
    struct CanonicalReceipt {
        hmac_user_id: String,
        purged_at: String,
        key_version: u32,
    }
    serde_json::to_vec(&CanonicalReceipt {
        hmac_user_id: format!("{:x}", Hex(&receipt.hmac_user_id)),
        purged_at: receipt
            .purged_at
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        key_version: receipt.key_version,
    })
}

struct Hex<'a>(&'a [u8]);

impl std::fmt::LowerHex for Hex<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for byte in self.0 {
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}
