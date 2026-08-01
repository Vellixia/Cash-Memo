//! Authentication capabilities and mandatory owner-scoping rules.

use async_trait::async_trait;
use cashmemo_domain::{DomainError, OwnerId};

/// Proof that a supported Appwrite Account call validated one session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthenticatedOwner(OwnerId);

impl AuthenticatedOwner {
    /// Creates the capability only after successful Account API validation.
    #[must_use]
    pub const fn after_account_validation(owner: OwnerId) -> Self {
        Self(owner)
    }

    /// Mandatory owner value for persistence predicates.
    #[must_use]
    pub const fn id(&self) -> &OwnerId {
        &self.0
    }
}

/// Supported-API opaque session validator.
#[async_trait]
pub trait SessionValidator: Send + Sync {
    /// Returns a principal only after live Appwrite Account validation.
    async fn validate(&self, session: &str) -> Result<AuthenticatedOwner, DomainError>;
}

/// Narrow scheduler-only capability, intentionally distinct from a user principal.
#[derive(Clone, Copy, Debug)]
pub struct WorkerCapability {
    _private: (),
}

impl WorkerCapability {
    /// Constructed only by the scheduled command entrypoint.
    #[must_use]
    pub const fn scheduled_entrypoint() -> Self {
        Self { _private: () }
    }
}

/// Narrow restore-reconciliation capability.
#[derive(Clone, Copy, Debug)]
pub struct ReconcileCapability {
    _private: (),
}

impl ReconcileCapability {
    /// Constructed only by the restore-reconcile command entrypoint.
    #[must_use]
    pub const fn restore_entrypoint() -> Self {
        Self { _private: () }
    }
}
