use argon2::{
    Argon2, Params,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use thiserror::Error;

const MIN_CODE_POINTS: usize = 15;
const MAX_CODE_POINTS: usize = 128;
const MAX_UTF8_BYTES: usize = 512;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Argon2idConfig {
    memory_cost_kib: u32,
    time_cost: u32,
    parallelism: u32,
}

impl Default for Argon2idConfig {
    fn default() -> Self {
        Self {
            memory_cost_kib: 65_536,
            time_cost: 3,
            parallelism: 1,
        }
    }
}

impl Argon2idConfig {
    pub fn new(
        memory_cost_kib: u32,
        time_cost: u32,
        parallelism: u32,
    ) -> Result<Self, PasswordError> {
        if memory_cost_kib < 65_536 || time_cost < 3 || parallelism == 0 {
            return Err(PasswordError::UnsafeParameters);
        }
        Params::new(memory_cost_kib, time_cost, parallelism, None)
            .map_err(|_| PasswordError::UnsafeParameters)?;
        Ok(Self {
            memory_cost_kib,
            time_cost,
            parallelism,
        })
    }

    pub fn memory_cost_kib(&self) -> u32 {
        self.memory_cost_kib
    }

    fn params(&self) -> Result<Params, PasswordError> {
        Params::new(self.memory_cost_kib, self.time_cost, self.parallelism, None)
            .map_err(|_| PasswordError::Hash)
    }
}

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
    #[error("Argon2id parameters are below the approved security floor")]
    UnsafeParameters,
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

pub fn hash_password(password: &str, config: &Argon2idConfig) -> Result<String, PasswordError> {
    validate_password(password)?;
    let params = config.params()?;
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
