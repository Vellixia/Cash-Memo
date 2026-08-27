mod smtp;

use async_trait::async_trait;
use thiserror::Error;

pub use smtp::{SmtpEmailSender, password_reset_email_body, verification_email_body};

#[derive(Debug, Error)]
pub enum EmailError {
    #[error("email delivery failed")]
    Delivery,
}

#[async_trait]
pub trait EmailSender: Send + Sync {
    async fn send_verification(&self, to: &str, raw_token: &str) -> Result<(), EmailError>;
    async fn send_password_reset(&self, to: &str, raw_token: &str) -> Result<(), EmailError>;
}

pub struct UnconfiguredEmailSender;

#[async_trait]
impl EmailSender for UnconfiguredEmailSender {
    async fn send_verification(&self, _: &str, _: &str) -> Result<(), EmailError> {
        Err(EmailError::Delivery)
    }

    async fn send_password_reset(&self, _: &str, _: &str) -> Result<(), EmailError> {
        Err(EmailError::Delivery)
    }
}
