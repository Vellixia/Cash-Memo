//! Runtime fingerprint KEK keyring and fail-closed retirement policy.

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use cashmemo_domain::{DomainError, ErrorCode};
use zeroize::Zeroizing;

/// One runtime-provided 256-bit key-encryption key.
pub struct RuntimeKek {
    id: String,
    key: Zeroizing<[u8; 32]>,
}

impl RuntimeKek {
    /// Validates stable escrow identifier and takes key ownership.
    pub fn new(id: &str, key: [u8; 32]) -> Result<Self, DomainError> {
        if id.is_empty()
            || id.len() > 16
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(unavailable());
        }
        Ok(Self {
            id: id.to_owned(),
            key: Zeroizing::new(key),
        })
    }
}

impl std::fmt::Debug for RuntimeKek {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("RuntimeKek([REDACTED])")
    }
}

/// Active plus retained decrypt-only fingerprint KEKs.
pub struct KekKeyring {
    active_id: String,
    keys: BTreeMap<String, Zeroizing<[u8; 32]>>,
}

impl KekKeyring {
    /// Builds a keyring; duplicate, missing-active, or empty keysets fail closed.
    pub fn new(active_id: &str, keys: Vec<RuntimeKek>) -> Result<Self, DomainError> {
        let mut map = BTreeMap::new();
        for key in keys {
            if map.insert(key.id, key.key).is_some() {
                return Err(unavailable());
            }
        }
        if map.is_empty() || !map.contains_key(active_id) {
            return Err(unavailable());
        }
        Ok(Self {
            active_id: active_id.to_owned(),
            keys: map,
        })
    }

    /// Loads base64 keys from runtime secret material, never from checked-in config.
    pub fn from_environment() -> Result<Self, DomainError> {
        let active = std::env::var("FINGERPRINT_KEK_CURRENT_ID").map_err(|_| unavailable())?;
        let current = std::env::var("FINGERPRINT_KEK_CURRENT").map_err(|_| unavailable())?;
        let mut keys = vec![decode_runtime_key(&active, &current)?];
        let previous_id = std::env::var("FINGERPRINT_KEK_PREVIOUS_ID").ok();
        let previous = std::env::var("FINGERPRINT_KEK_PREVIOUS").ok();
        match (previous_id, previous) {
            (Some(id), Some(encoded)) => keys.push(decode_runtime_key(&id, &encoded)?),
            (None, None) => {}
            _ => return Err(unavailable()),
        }
        Self::new(&active, keys)
    }

    /// Current encrypting escrow ID and key.
    pub(crate) fn active(&self) -> Result<(&str, &[u8; 32]), DomainError> {
        self.keys
            .get(&self.active_id)
            .map(|key| (self.active_id.as_str(), &**key))
            .ok_or_else(unavailable)
    }

    /// Retained decryption key by exact escrow ID.
    pub(crate) fn get(&self, id: &str) -> Result<&[u8; 32], DomainError> {
        self.keys.get(id).map(|key| &**key).ok_or_else(unavailable)
    }

    /// Lists safe escrow identifiers for inventory; never key material.
    #[must_use]
    pub fn escrow_ids(&self) -> Vec<&str> {
        self.keys.keys().map(String::as_str).collect()
    }

    /// Authorizes retirement only for inactive KEKs with zero persisted references.
    pub fn retire(&self, id: &str, persisted_reference_count: u64) -> Result<(), DomainError> {
        if id == self.active_id || persisted_reference_count != 0 || !self.keys.contains_key(id) {
            return Err(unavailable());
        }
        Ok(())
    }
}

fn decode_runtime_key(id: &str, encoded: &str) -> Result<RuntimeKek, DomainError> {
    let decoded = STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| unavailable())?;
    let key: [u8; 32] = decoded.try_into().map_err(|_| unavailable())?;
    RuntimeKek::new(id, key)
}

impl std::fmt::Debug for KekKeyring {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("KekKeyring")
            .field("active_id", &self.active_id)
            .field("key_count", &self.keys.len())
            .finish()
    }
}

fn unavailable() -> DomainError {
    DomainError::retryable(
        ErrorCode::IdempotencyVerificationUnavailable,
        "idempotency verification unavailable",
    )
}
