use async_trait::async_trait;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};
use url::Url;

use crate::config::{SmtpEmailConfig, SmtpSecurity};

use super::{EmailError, EmailSender};

pub struct SmtpEmailSender {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
    public_origin: Url,
}

impl SmtpEmailSender {
    pub fn new(config: &SmtpEmailConfig, public_origin: &Url) -> Result<Self, EmailError> {
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
            public_origin: public_origin.clone(),
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

fn verification_body(public_origin: &Url, raw_token: &str) -> String {
    let mut verification_url = public_origin
        .join("verify-email")
        .expect("validated origin accepts a relative verification path");
    verification_url
        .query_pairs_mut()
        .append_pair("token", raw_token);
    format!("Verify your Cashmemo email:\n{verification_url}")
}

#[async_trait]
impl EmailSender for SmtpEmailSender {
    async fn send_verification(&self, to: &str, raw_token: &str) -> Result<(), EmailError> {
        self.send(
            to,
            "Verify your Cashmemo email",
            verification_body(&self.public_origin, raw_token),
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

#[cfg(test)]
mod tests {
    use url::Url;

    use super::verification_body;

    #[test]
    fn verification_body_contains_public_percent_encoded_url() {
        let origin = Url::parse("https://cashmemo.example/").unwrap();

        assert_eq!(
            verification_body(&origin, "raw +/=?& token"),
            "Verify your Cashmemo email:\nhttps://cashmemo.example/verify-email?token=raw+%2B%2F%3D%3F%26+token"
        );
    }
}
