//! Keyed immutable creation fingerprint and AEAD-wrapped per-memo MAC key.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use cashmemo_domain::{DomainError, ErrorCode, OwnerId};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use crate::keyring::KekKeyring;

const MAC_DOMAIN: &[u8] = b"cashmemo.creation-fingerprint.v1\0";
const WRAP_DOMAIN: &[u8] = b"cashmemo.fingerprint-key-wrap.v1\0";

/// Persisted immutable MAC plus wrapped random per-memo key metadata.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct FingerprintEnvelope {
    /// Lowercase HMAC-SHA-256 hex.
    pub mac_hex: String,
    /// URL-safe-base64 AEAD ciphertext including authentication tag.
    pub wrapped_key_ciphertext: String,
    /// URL-safe-base64 96-bit nonce.
    pub wrapped_key_nonce: String,
    /// Runtime escrow KEK identifier.
    pub kek_id: String,
}

impl std::fmt::Debug for FingerprintEnvelope {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("FingerprintEnvelope([REDACTED])")
    }
}

/// Construction namespace.
pub struct CreationFingerprint;

impl CreationFingerprint {
    /// Creates a random 256-bit per-memo MAC key, immutable MAC, and AEAD key wrap.
    pub fn create(
        keyring: &KekKeyring,
        owner: &OwnerId,
        creation_id: &str,
        canonical_document: &[u8],
    ) -> Result<FingerprintEnvelope, DomainError> {
        let mut mac_key = Zeroizing::new([0_u8; 32]);
        rand::rng().fill_bytes(&mut *mac_key);
        let mac_hex = mac(&mac_key, canonical_document)?;
        let (kek_id, kek) = keyring.active()?;
        let (wrapped_key_ciphertext, wrapped_key_nonce) = wrap(kek, owner, creation_id, &mac_key)?;
        Ok(FingerprintEnvelope {
            mac_hex,
            wrapped_key_ciphertext,
            wrapped_key_nonce,
            kek_id: kek_id.to_owned(),
        })
    }

    /// Verifies using only immutable MAC metadata and retained key material.
    pub fn verify(
        keyring: &KekKeyring,
        owner: &OwnerId,
        creation_id: &str,
        canonical_document: &[u8],
        envelope: &FingerprintEnvelope,
    ) -> Result<bool, DomainError> {
        let key = unwrap(keyring, owner, creation_id, envelope)?;
        let actual = mac(&key, canonical_document)?;
        if actual.len() != envelope.mac_hex.len() {
            return Ok(false);
        }
        Ok(actual.as_bytes().ct_eq(envelope.mac_hex.as_bytes()).into())
    }

    /// Rewraps the per-memo key only; the immutable MAC is preserved byte-for-byte.
    pub fn rewrap(
        old_keyring: &KekKeyring,
        new_keyring: &KekKeyring,
        owner: &OwnerId,
        creation_id: &str,
        envelope: &FingerprintEnvelope,
    ) -> Result<FingerprintEnvelope, DomainError> {
        let key = unwrap(old_keyring, owner, creation_id, envelope)?;
        let (kek_id, kek) = new_keyring.active()?;
        let (wrapped_key_ciphertext, wrapped_key_nonce) = wrap(kek, owner, creation_id, &key)?;
        Ok(FingerprintEnvelope {
            mac_hex: envelope.mac_hex.clone(),
            wrapped_key_ciphertext,
            wrapped_key_nonce,
            kek_id: kek_id.to_owned(),
        })
    }
}

fn mac(key: &[u8; 32], document: &[u8]) -> Result<String, DomainError> {
    let mut value = <Hmac<Sha256> as Mac>::new_from_slice(key).map_err(|_| unavailable())?;
    value.update(MAC_DOMAIN);
    value.update(document);
    Ok(hex(&value.finalize().into_bytes()))
}

fn wrap(
    kek: &[u8; 32],
    owner: &OwnerId,
    creation_id: &str,
    mac_key: &[u8; 32],
) -> Result<(String, String), DomainError> {
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| unavailable())?;
    let mut nonce = [0_u8; 12];
    rand::rng().fill_bytes(&mut nonce);
    let aad = associated_data(owner, creation_id);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: mac_key,
                aad: &aad,
            },
        )
        .map_err(|_| unavailable())?;
    Ok((
        URL_SAFE_NO_PAD.encode(ciphertext),
        URL_SAFE_NO_PAD.encode(nonce),
    ))
}

fn unwrap(
    keyring: &KekKeyring,
    owner: &OwnerId,
    creation_id: &str,
    envelope: &FingerprintEnvelope,
) -> Result<Zeroizing<[u8; 32]>, DomainError> {
    let kek = keyring.get(&envelope.kek_id)?;
    let nonce = URL_SAFE_NO_PAD
        .decode(envelope.wrapped_key_nonce.as_bytes())
        .map_err(|_| unavailable())?;
    let nonce: [u8; 12] = nonce.try_into().map_err(|_| unavailable())?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(envelope.wrapped_key_ciphertext.as_bytes())
        .map_err(|_| unavailable())?;
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| unavailable())?;
    let aad = associated_data(owner, creation_id);
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| unavailable())?;
    let key: [u8; 32] = plaintext.try_into().map_err(|_| unavailable())?;
    Ok(Zeroizing::new(key))
}

fn associated_data(owner: &OwnerId, creation_id: &str) -> Vec<u8> {
    let mut value =
        Vec::with_capacity(WRAP_DOMAIN.len() + owner.as_str().len() + creation_id.len());
    value.extend_from_slice(WRAP_DOMAIN);
    value.extend_from_slice(owner.as_str().as_bytes());
    value.push(0);
    value.extend_from_slice(creation_id.as_bytes());
    value
}

fn hex(value: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(value.len() * 2);
    for byte in value {
        encoded.push(char::from(DIGITS[usize::from(byte >> 4)]));
        encoded.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn unavailable() -> DomainError {
    DomainError::retryable(
        ErrorCode::IdempotencyVerificationUnavailable,
        "idempotency verification unavailable",
    )
}
