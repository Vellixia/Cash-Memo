use thiserror::Error;

use crate::{config::ConfigError, db::target_guard::TargetError};

#[derive(Debug, Error)]
pub enum ApiError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Target(#[from] TargetError),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error(transparent)]
    Server(#[from] std::io::Error),
}
