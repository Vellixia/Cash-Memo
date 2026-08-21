use std::{env, net::SocketAddr, time::Duration};

use thiserror::Error;

#[derive(Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub smtp: SmtpEmailConfig,
    pub auth: crate::auth::AuthConfig,
    /// V1 runs one Rust API replica. These in-memory limits are not distributed;
    /// add a shared limiter before scaling to multiple replicas.
    pub http_safety: HttpSafetyConfig,
}

#[derive(Clone, Debug)]
pub struct SmtpEmailConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from: String,
}

#[derive(Clone, Debug)]
pub struct HttpSafetyConfig {
    pub allowed_origins: Vec<String>,
    pub auth_rate_limits: AuthRateLimitSettings,
}

#[derive(Clone, Debug)]
pub struct AuthRateLimitSettings {
    pub register: RateLimitSettings,
    pub verification_resend: RateLimitSettings,
    pub login: RateLimitSettings,
    pub reset_request: RateLimitSettings,
}

#[derive(Clone, Debug)]
pub struct RateLimitSettings {
    pub max_attempts: usize,
    pub window: Duration,
    pub max_keys: usize,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let database_url =
            env::var("CASHMEMO_V1_DATABASE_URL").map_err(|_| ConfigError::MissingDatabaseUrl)?;
        let bind_addr = env::var("CASHMEMO_V1_BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:3000".to_owned())
            .parse()
            .map_err(ConfigError::InvalidBindAddress)?;
        let http_safety = HttpSafetyConfig::from_env()?;
        let smtp = SmtpEmailConfig::from_env()?;
        let auth = crate::auth::AuthConfig {
            idle_timeout: Duration::from_secs(parse_positive(
                "CASHMEMO_V1_SESSION_IDLE_SECONDS",
                7 * 24 * 60 * 60,
            )? as u64),
            absolute_timeout: Duration::from_secs(parse_positive(
                "CASHMEMO_V1_SESSION_ABSOLUTE_SECONDS",
                30 * 24 * 60 * 60,
            )? as u64),
            touch_interval: Duration::from_secs(parse_positive(
                "CASHMEMO_V1_SESSION_TOUCH_SECONDS",
                60 * 60,
            )? as u64),
        };

        Ok(Self {
            database_url,
            bind_addr,
            smtp,
            auth,
            http_safety,
        })
    }
}

impl SmtpEmailConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let host = env::var("CASHMEMO_V1_SMTP_HOST").map_err(|_| ConfigError::MissingSmtpHost)?;
        if host.trim().is_empty() {
            return Err(ConfigError::MissingSmtpHost);
        }
        let from = env::var("CASHMEMO_V1_SMTP_FROM").map_err(|_| ConfigError::MissingSmtpFrom)?;
        if from.trim().is_empty() {
            return Err(ConfigError::MissingSmtpFrom);
        }
        let username = env::var("CASHMEMO_V1_SMTP_USERNAME")
            .ok()
            .filter(|value| !value.is_empty());
        let password = env::var("CASHMEMO_V1_SMTP_PASSWORD")
            .ok()
            .filter(|value| !value.is_empty());
        if username.is_some() != password.is_some() {
            return Err(ConfigError::IncompleteSmtpCredentials);
        }
        let port = env::var("CASHMEMO_V1_SMTP_PORT")
            .unwrap_or_else(|_| "587".to_owned())
            .parse()
            .ok()
            .filter(|port: &u16| *port > 0)
            .ok_or(ConfigError::InvalidSmtpPort)?;
        Ok(Self {
            host,
            port,
            username,
            password,
            from,
        })
    }
}

impl Default for HttpSafetyConfig {
    fn default() -> Self {
        let settings = RateLimitSettings {
            max_attempts: 5,
            window: Duration::from_secs(60),
            max_keys: 10_000,
        };
        Self {
            allowed_origins: vec!["http://localhost:3000".to_owned()],
            auth_rate_limits: AuthRateLimitSettings {
                register: settings.clone(),
                verification_resend: settings.clone(),
                login: settings.clone(),
                reset_request: settings,
            },
        }
    }
}

impl HttpSafetyConfig {
    fn from_env() -> Result<Self, ConfigError> {
        let mut config = Self::default();
        if let Ok(origins) = env::var("CASHMEMO_V1_ALLOWED_ORIGINS") {
            config.allowed_origins = origins
                .split(',')
                .map(str::trim)
                .filter(|origin| !origin.is_empty())
                .map(str::to_owned)
                .collect();
            if config.allowed_origins.is_empty() {
                return Err(ConfigError::EmptyAllowedOrigins);
            }
        }

        let window =
            Duration::from_secs(parse_positive("CASHMEMO_V1_AUTH_WINDOW_SECS", 60)? as u64);
        let max_keys = parse_positive("CASHMEMO_V1_AUTH_MAX_KEYS", 10_000)?;
        config.auth_rate_limits = AuthRateLimitSettings {
            register: rate_limit("CASHMEMO_V1_AUTH_REGISTER_LIMIT", window, max_keys)?,
            verification_resend: rate_limit(
                "CASHMEMO_V1_AUTH_VERIFICATION_RESEND_LIMIT",
                window,
                max_keys,
            )?,
            login: rate_limit("CASHMEMO_V1_AUTH_LOGIN_LIMIT", window, max_keys)?,
            reset_request: rate_limit("CASHMEMO_V1_AUTH_RESET_REQUEST_LIMIT", window, max_keys)?,
        };
        Ok(config)
    }
}

impl AuthRateLimitSettings {
    pub(crate) fn for_class(
        &self,
        class: crate::http::rate_limit::EndpointClass,
    ) -> &RateLimitSettings {
        match class {
            crate::http::rate_limit::EndpointClass::Register => &self.register,
            crate::http::rate_limit::EndpointClass::VerificationResend => &self.verification_resend,
            crate::http::rate_limit::EndpointClass::Login => &self.login,
            crate::http::rate_limit::EndpointClass::ResetRequest => &self.reset_request,
        }
    }
}

fn rate_limit(
    name: &'static str,
    window: Duration,
    max_keys: usize,
) -> Result<RateLimitSettings, ConfigError> {
    Ok(RateLimitSettings {
        max_attempts: parse_positive(name, 5)?,
        window,
        max_keys,
    })
}

fn parse_positive(name: &'static str, default: usize) -> Result<usize, ConfigError> {
    match env::var(name) {
        Ok(value) => value
            .parse::<usize>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or(ConfigError::InvalidPositiveEnvironment { name, value }),
        Err(_) => Ok(default),
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("CASHMEMO_V1_DATABASE_URL is required")]
    MissingDatabaseUrl,
    #[error("CASHMEMO_V1_BIND_ADDR is not a valid socket address")]
    InvalidBindAddress(#[source] std::net::AddrParseError),
    #[error("CASHMEMO_V1_ALLOWED_ORIGINS must contain at least one origin")]
    EmptyAllowedOrigins,
    #[error("CASHMEMO_V1_SMTP_HOST is required")]
    MissingSmtpHost,
    #[error("CASHMEMO_V1_SMTP_FROM is required")]
    MissingSmtpFrom,
    #[error("CASHMEMO_V1_SMTP_USERNAME and CASHMEMO_V1_SMTP_PASSWORD must be set together")]
    IncompleteSmtpCredentials,
    #[error("CASHMEMO_V1_SMTP_PORT must be a positive u16")]
    InvalidSmtpPort,
    #[error("{name} must be a positive integer, got {value}")]
    InvalidPositiveEnvironment { name: &'static str, value: String },
}
