//! Supported Account API session validation.

use async_trait::async_trait;
use cashmemo_application::authorization::{AuthenticatedOwner, SessionValidator};
use cashmemo_domain::{DomainError, ErrorCode, OwnerId};

use crate::{AppwriteClient, AppwriteError};

/// Live Appwrite session validator.
#[derive(Clone, Debug)]
pub struct AppwriteSessionValidator {
    client: AppwriteClient,
}

impl AppwriteSessionValidator {
    /// Creates validator over a supported-API client.
    #[must_use]
    pub const fn new(client: AppwriteClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl SessionValidator for AppwriteSessionValidator {
    async fn validate(&self, session: &str) -> Result<AuthenticatedOwner, DomainError> {
        match self.client.account_id(session).await {
            Ok(id) => OwnerId::parse_authenticated_account(&id)
                .map(AuthenticatedOwner::after_account_validation),
            Err(AppwriteError::Unauthorized | AppwriteError::NotFound) => Err(DomainError::safe(
                ErrorCode::AuthRequired,
                "authentication required",
            )),
            Err(_) => Err(DomainError::retryable(
                ErrorCode::DependencyUnavailable,
                "authentication dependency unavailable",
            )),
        }
    }
}
