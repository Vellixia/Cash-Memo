use async_trait::async_trait;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};

use crate::config::{SmtpEmailConfig, SmtpSecurity};

use super::{EmailError, EmailSender};

pub struct SmtpEmailSender {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl SmtpEmailSender {
    pub fn new(config: &SmtpEmailConfig) -> Result<Self, EmailError> {
        let mut builder = match config.security {
            SmtpSecurity::StartTls => {
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
                    .map_err(|_| EmailError::Delivery)?
                    .port(config.port)
            }
            SmtpSecurity::Plaintext => {
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
                    .port(config.port)
            }
        };
        if let (Some(username), Some(password)) = (&config.username, &config.password) {
            builder = builder.credentials(Credentials::new(username.clone(), password.clone()));
        }
        Ok(Self {
            transport: builder.build(),
            from: config.from.parse().map_err(|_| EmailError::Delivery)?,
        })
    }

    async fn send(&self, to: &str, subject: &str, body: String) -> Result<(), EmailError> {
        let message = Message::builder()
            .from(self.from.clone())
            .to(to.parse().map_err(|_| EmailError::Delivery)?)
            .subject(subject)
            .body(body)
            .map_err(|_| EmailError::Delivery)?;
        self.transport
            .send(message)
            .await
            .map_err(|_| EmailError::Delivery)?;
        Ok(())
    }
}

#[async_trait]
impl EmailSender for SmtpEmailSender {
    async fn send_verification(&self, to: &str, raw_token: &str) -> Result<(), EmailError> {
        self.send(
            to,
            "Verify your Cashmemo email",
            format!("Verification token: {raw_token}"),
        )
        .await
    }

    async fn send_password_reset(&self, to: &str, raw_token: &str) -> Result<(), EmailError> {
        self.send(
            to,
            "Reset your Cashmemo password",
            format!("Password reset token: {raw_token}"),
        )
        .await
    }
}
