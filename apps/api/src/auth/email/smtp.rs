use async_trait::async_trait;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    transport::smtp::authentication::Credentials,
};
use url::{Url, form_urlencoded};

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

/// Builds a token link whose secret lives only in the URL fragment, so it never reaches the
/// Next.js server, the reverse proxy, HTTP access logs, or Rust request logs.
fn fragment_token_url(public_origin: &Url, path: &str, raw_token: &str) -> Url {
    let mut url = public_origin
        .join(path)
        .expect("validated origin accepts a relative token path");
    url.set_query(None);
    url.set_fragment(Some(
        &form_urlencoded::Serializer::new(String::new())
            .append_pair("token", raw_token)
            .finish(),
    ));
    url
}

pub fn verification_email_body(public_origin: &Url, raw_token: &str) -> String {
    let url = fragment_token_url(public_origin, "verify-email", raw_token);
    format!("Verify your Cashmemo email:\n{url}")
}

pub fn password_reset_email_body(public_origin: &Url, raw_token: &str) -> String {
    let url = fragment_token_url(public_origin, "reset-password", raw_token);
    format!("Reset your Cashmemo password:\n{url}")
}

#[async_trait]
impl EmailSender for SmtpEmailSender {
    async fn send_verification(&self, to: &str, raw_token: &str) -> Result<(), EmailError> {
        self.send(
            to,
            "Verify your Cashmemo email",
            verification_email_body(&self.public_origin, raw_token),
        )
        .await
    }

    async fn send_password_reset(&self, to: &str, raw_token: &str) -> Result<(), EmailError> {
        self.send(
            to,
            "Reset your Cashmemo password",
            password_reset_email_body(&self.public_origin, raw_token),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use url::Url;

    use super::{password_reset_email_body, verification_email_body};

    #[test]
    fn token_bodies_encode_the_token_only_in_the_fragment() {
        let origin = Url::parse("https://cashmemo.example/").unwrap();

        assert_eq!(
            verification_email_body(&origin, "raw +/=?& token"),
            "Verify your Cashmemo email:\nhttps://cashmemo.example/verify-email#token=raw+%2B%2F%3D%3F%26+token"
        );
        assert_eq!(
            password_reset_email_body(&origin, "raw +/=?& token"),
            "Reset your Cashmemo password:\nhttps://cashmemo.example/reset-password#token=raw+%2B%2F%3D%3F%26+token"
        );
    }
}
