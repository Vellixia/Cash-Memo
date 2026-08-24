use std::{env, net::SocketAddr, time::Duration};

use thiserror::Error;
use url::Url;

#[derive(Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub bind_addr: SocketAddr,
    pub public_origin: Url,
    pub smtp: SmtpEmailConfig,
    pub environment: AppEnvironment,
    pub auth: crate::auth::AuthConfig,
    /// V1 runs one Rust API replica. These in-memory limits are not distributed;
    /// add a shared limiter before scaling to multiple replicas.
    pub http_safety: HttpSafetyConfig,
}

/// Command-only config. `AppConfig::from_env` intentionally never reads these secrets.
#[cfg(feature = "s3-receipts")]
#[derive(Clone, Debug)]
pub struct DeletionReceiptCommandConfig {
    pub s3: crate::receipts::s3::S3ReceiptConfig,
    pub hmac_keys: Vec<(u32, Vec<u8>)>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppEnvironment {
    Development,
    Test,
    Production,
}

impl AppEnvironment {
    fn from_env() -> Result<Self, ConfigError> {
        match env::var("CASHMEMO_V1_APP_ENV")
            .unwrap_or_else(|_| "development".to_owned())
            .to_ascii_lowercase()
            .as_str()
        {
            "development" => Ok(Self::Development),
            "test" => Ok(Self::Test),
            "production" => Ok(Self::Production),
            _ => Err(ConfigError::InvalidAppEnvironment),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SmtpEmailConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub from: String,
    pub security: SmtpSecurity,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SmtpSecurity {
    #[default]
    StartTls,
    Plaintext,
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
        let public_origin = parse_public_origin(
            &env::var("CASHMEMO_V1_PUBLIC_ORIGIN").map_err(|_| ConfigError::MissingPublicOrigin)?,
        )?;
        let environment = AppEnvironment::from_env()?;
        let http_safety = HttpSafetyConfig::from_env()?;
        let smtp = SmtpEmailConfig::from_env(environment)?;
        let password_hash = crate::auth::Argon2idConfig::new(
            parse_positive_u32("CASHMEMO_V1_ARGON2_MEMORY_KIB", 65_536)?,
            parse_positive_u32("CASHMEMO_V1_ARGON2_TIME_COST", 3)?,
            parse_positive_u32("CASHMEMO_V1_ARGON2_PARALLELISM", 1)?,
        )
        .map_err(|_| ConfigError::InvalidArgon2Parameters)?;
        let auth = crate::auth::AuthConfig::new(
            Duration::from_secs(parse_positive(
                "CASHMEMO_V1_SESSION_IDLE_SECONDS",
                7 * 24 * 60 * 60,
            )? as u64),
            Duration::from_secs(parse_positive(
                "CASHMEMO_V1_SESSION_ABSOLUTE_SECONDS",
                30 * 24 * 60 * 60,
            )? as u64),
            Duration::from_secs(
                parse_positive("CASHMEMO_V1_SESSION_TOUCH_SECONDS", 60 * 60)? as u64,
            ),
            password_hash,
        )
        .map_err(|_| ConfigError::InvalidSessionConfiguration)?;

        Ok(Self {
            database_url,
            bind_addr,
            public_origin,
            smtp,
            environment,
            auth,
            http_safety,
        })
    }
}

fn parse_public_origin(value: &str) -> Result<Url, ConfigError> {
    let origin = Url::parse(value).map_err(|_| ConfigError::InvalidPublicOrigin)?;
    let valid_scheme = matches!(origin.scheme(), "http" | "https");
    let is_origin_only = origin.host().is_some()
        && origin.username().is_empty()
        && origin.password().is_none()
        && origin.path() == "/"
        && origin.query().is_none()
        && origin.fragment().is_none();
    if !valid_scheme || !is_origin_only {
        return Err(ConfigError::InvalidPublicOrigin);
    }
    Ok(origin)
}

#[cfg(feature = "s3-receipts")]
impl DeletionReceiptCommandConfig {
    pub fn from_env(environment: AppEnvironment) -> Result<Self, ConfigError> {
        let required = |name: &'static str| {
            env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .ok_or(ConfigError::MissingDeletionReceiptConfig(name))
        };
        let hmac_keys = required("DELETION_RECEIPT_HMAC_KEYS")?
            .split(',')
            .map(|item| {
                let (version, hex) = item
                    .split_once(':')
                    .ok_or(ConfigError::InvalidDeletionReceiptKeys)?;
                let key = hex_decode(hex).ok_or(ConfigError::InvalidDeletionReceiptKeys)?;
                if key.len() < 32 {
                    return Err(ConfigError::InvalidDeletionReceiptKeys);
                }
                Ok((
                    version
                        .parse()
                        .map_err(|_| ConfigError::InvalidDeletionReceiptKeys)?,
                    key,
                ))
            })
            .collect::<Result<Vec<_>, ConfigError>>()?;
        if hmac_keys.is_empty() {
            return Err(ConfigError::InvalidDeletionReceiptKeys);
        }
        Ok(Self {
            s3: crate::receipts::s3::S3ReceiptConfig {
                endpoint: required("DELETION_RECEIPT_S3_ENDPOINT")?,
                region: required("DELETION_RECEIPT_S3_REGION")?,
                bucket: required("DELETION_RECEIPT_S3_BUCKET")?,
                prefix: required("DELETION_RECEIPT_S3_PREFIX")?,
                access_key_id: required("DELETION_RECEIPT_S3_ACCESS_KEY_ID")?,
                secret_access_key: required("DELETION_RECEIPT_S3_SECRET_ACCESS_KEY")?,
                allow_insecure_local_endpoint: environment != AppEnvironment::Production,
            },
            hmac_keys,
        })
    }
    pub fn current_hmac_key(&self) -> &(u32, Vec<u8>) {
        self.hmac_keys
            .iter()
            .max_by_key(|(version, _)| version)
            .expect("validated nonempty key ring")
    }
}

#[cfg(feature = "s3-receipts")]
fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    value
        .as_bytes()
        .chunks(2)
        .map(|pair| {
            std::str::from_utf8(pair)
                .ok()
                .and_then(|value| u8::from_str_radix(value, 16).ok())
        })
        .collect()
}

impl SmtpEmailConfig {
    fn from_env(environment: AppEnvironment) -> Result<Self, ConfigError> {
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
        let security = match env::var("CASHMEMO_V1_SMTP_SECURITY")
            .unwrap_or_else(|_| "starttls".to_owned())
            .to_ascii_lowercase()
            .as_str()
        {
            "starttls" => SmtpSecurity::StartTls,
            "plaintext" => SmtpSecurity::Plaintext,
            _ => return Err(ConfigError::InvalidSmtpSecurity),
        };
        let config = Self {
            host,
            port,
            username,
            password,
            from,
            security,
        };
        config.validate_for_environment(environment)?;
        Ok(config)
    }

    pub fn validate_for_environment(&self, environment: AppEnvironment) -> Result<(), ConfigError> {
        if self.security == SmtpSecurity::Plaintext
            && (environment == AppEnvironment::Production || !is_local_mailpit_host(&self.host))
        {
            return Err(ConfigError::PlaintextSmtpNotAllowed);
        }
        Ok(())
    }
}

fn is_local_mailpit_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "mailpit")
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

fn parse_positive_u32(name: &'static str, default: u32) -> Result<u32, ConfigError> {
    match env::var(name) {
        Ok(value) => value
            .parse::<u32>()
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
    #[error("CASHMEMO_V1_PUBLIC_ORIGIN is required")]
    MissingPublicOrigin,
    #[error(
        "CASHMEMO_V1_PUBLIC_ORIGIN must be an HTTP(S) origin without credentials, path, query, or fragment"
    )]
    InvalidPublicOrigin,
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
    #[error("CASHMEMO_V1_SMTP_SECURITY must be starttls or plaintext")]
    InvalidSmtpSecurity,
    #[error("CASHMEMO_V1_APP_ENV must be development, test, or production")]
    InvalidAppEnvironment,
    #[error("plaintext SMTP is allowed only for development/test local Mailpit")]
    PlaintextSmtpNotAllowed,
    #[error("Argon2id parameters do not meet the approved security floor")]
    InvalidArgon2Parameters,
    #[error("session configuration exceeds approved limits")]
    InvalidSessionConfiguration,
    #[error("{0} is required only for purge/replay commands")]
    MissingDeletionReceiptConfig(&'static str),
    #[error(
        "DELETION_RECEIPT_HMAC_KEYS must be comma-separated version:hex keys of at least 32 bytes"
    )]
    InvalidDeletionReceiptKeys,
    #[error("{name} must be a positive integer, got {value}")]
    InvalidPositiveEnvironment { name: &'static str, value: String },
}

#[cfg(test)]
mod tests {
    use super::parse_public_origin;

    #[test]
    fn public_origin_accepts_only_http_origin_without_url_components() {
        assert_eq!(
            parse_public_origin("http://localhost:3000/")
                .unwrap()
                .as_str(),
            "http://localhost:3000/"
        );
        assert_eq!(
            parse_public_origin("https://cashmemo.example")
                .unwrap()
                .as_str(),
            "https://cashmemo.example/"
        );

        for invalid in [
            "cashmemo.example",
            "ftp://cashmemo.example",
            "https://user@cashmemo.example",
            "https://cashmemo.example/app",
            "https://cashmemo.example/?source=test",
            "https://cashmemo.example/#fragment",
        ] {
            assert!(parse_public_origin(invalid).is_err(), "accepted {invalid}");
        }
    }
}
