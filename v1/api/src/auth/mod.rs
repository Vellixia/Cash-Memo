pub mod email;
mod model;
mod password;
pub mod routes;
mod service;

pub use email::{EmailError, EmailSender, SmtpEmailSender, UnconfiguredEmailSender};
pub use model::{AuthConfig, AuthConfigError, AuthSession, LoginSession, SessionAccess};
pub use password::{
    Argon2idConfig, PasswordError, validate_password, verify_password as verify_current_password,
};
pub use service::{AuthError, AuthService, normalize_email};
