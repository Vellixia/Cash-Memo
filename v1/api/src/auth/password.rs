use argon2::{
    Argon2, Params,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use thiserror::Error;

const MIN_CODE_POINTS: usize = 15;
const MAX_CODE_POINTS: usize = 128;
const MAX_UTF8_BYTES: usize = 512;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PasswordError {
    #[error("password must have at least 15 Unicode code points")]
    TooShort,
    #[error("password must have at most 128 Unicode code points")]
    TooLong,
    #[error("password must have at most 512 UTF-8 bytes")]
    TooManyBytes,
    #[error("password hash is invalid")]
    Hash,
}

pub fn validate_password(password: &str) -> Result<(), PasswordError> {
    let count = password.chars().count();
    if count < MIN_CODE_POINTS {
        return Err(PasswordError::TooShort);
    }
    if count > MAX_CODE_POINTS {
        return Err(PasswordError::TooLong);
    }
    if password.len() > MAX_UTF8_BYTES {
        return Err(PasswordError::TooManyBytes);
    }
    Ok(())
}

pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    validate_password(password)?;
    let params = Params::new(65_536, 3, 1, None).map_err(|_| PasswordError::Hash)?;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params)
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| PasswordError::Hash)
}

pub fn verify_password(password: &str, encoded: &str) -> bool {
    PasswordHash::new(encoded).ok().is_some_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}
