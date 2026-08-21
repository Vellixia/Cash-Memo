pub mod email;
mod model;
mod password;
pub mod routes;
mod service;

pub use email::{EmailError, EmailSender, SmtpEmailSender, UnconfiguredEmailSender};
pub use model::{AuthConfig, AuthSession, LoginSession, SessionAccess};
pub use password::{PasswordError, validate_password};
pub use service::{AuthError, AuthService, normalize_email};
