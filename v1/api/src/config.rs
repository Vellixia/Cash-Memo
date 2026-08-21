use std::{env, net::SocketAddr};

use thiserror::Error;

#[derive(Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url =
            env::var("CASHMEMO_V1_DATABASE_URL").map_err(|_| ConfigError::MissingDatabaseUrl)?;
        let bind_addr = env::var("CASHMEMO_V1_BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:3000".to_owned())
            .parse()
            .map_err(ConfigError::InvalidBindAddress)?;

        Ok(Self {
            database_url,
            bind_addr,
        })
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("CASHMEMO_V1_DATABASE_URL is required")]
    MissingDatabaseUrl,
    #[error("CASHMEMO_V1_BIND_ADDR is not a valid socket address")]
    InvalidBindAddress(#[source] std::net::AddrParseError),
}
