//! Create-or-resolve-retry orchestration independent from HTTP and Appwrite.

use std::sync::Arc;

use async_trait::async_trait;
use cashmemo_domain::create::{CreateCandidate, canonical_creation_document, validate_create};
use cashmemo_domain::privacy_pattern_v1::{PatternDecision, blocking_error, detect};
use cashmemo_domain::{DomainError, ErrorCode, MoneyMemo, MoneyMemoId};

use crate::authorization::AuthenticatedOwner;
use crate::clock::Clock;
use crate::creation_fingerprint::CreationFingerprint;
use crate::keyring::KekKeyring;
use crate::ports::{
    CreateMemoPersistence, PersistCreationOutcome, PreparedCreation, StoredCreation,
};

/// Public create outcome distinguishes HTTP 201 from matching-retry HTTP 200.
#[derive(Clone, Debug)]
pub struct CreateMoneyMemoResult {
    /// Created or current matching memo.
    pub memo: MoneyMemo,
    /// True only when this request created it.
    pub created: bool,
}

/// Narrow HTTP-facing application capability.
#[async_trait]
pub trait CreateMoneyMemo: Send + Sync {
    /// Validates and creates, or resolves a durable matching retry.
    async fn create(
        &self,
        owner: &AuthenticatedOwner,
        candidate: CreateCandidate,
    ) -> Result<CreateMoneyMemoResult, DomainError>;
}

/// Production create service.
pub struct CreateMoneyMemoService {
    persistence: Arc<dyn CreateMemoPersistence>,
    keyring: Arc<KekKeyring>,
    clock: Arc<dyn Clock>,
}

impl CreateMoneyMemoService {
    /// Wires inward-owned ports.
    #[must_use]
    pub fn new(
        persistence: Arc<dyn CreateMemoPersistence>,
        keyring: Arc<KekKeyring>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            persistence,
            keyring,
            clock,
        }
    }

    /// Executes concrete service without requiring trait import.
    pub async fn execute(
        &self,
        owner: &AuthenticatedOwner,
        candidate: CreateCandidate,
    ) -> Result<CreateMoneyMemoResult, DomainError> {
        let now = self.clock.now()?;
        let validated = validate_create(candidate, now)?;
        if let Some(note) = &validated.note
            && let PatternDecision::Block(detector) = detect(note)
        {
            return Err(blocking_error("note", detector));
        }
        let canonical = canonical_creation_document(owner.id(), &validated)?;
        if let Some(existing) = self
            .persistence
            .find_creation(owner, validated.creation_id)
            .await?
        {
            return self.resolve_retry(owner, &canonical, existing);
        }
        let fingerprint = CreationFingerprint::create(
            &self.keyring,
            owner.id(),
            &validated.creation_id.to_string(),
            &canonical,
        )?;
        let prepared = PreparedCreation {
            memo_id: MoneyMemoId::random(),
            values: validated,
            fingerprint,
            accepted_at: now,
        };
        match self.persistence.create(owner, &prepared).await? {
            PersistCreationOutcome::Created(memo) => Ok(CreateMoneyMemoResult {
                memo,
                created: true,
            }),
            PersistCreationOutcome::Existing(existing) => {
                self.resolve_retry(owner, &canonical, existing)
            }
        }
    }

    fn resolve_retry(
        &self,
        owner: &AuthenticatedOwner,
        canonical: &[u8],
        existing: StoredCreation,
    ) -> Result<CreateMoneyMemoResult, DomainError> {
        let matches = CreationFingerprint::verify(
            &self.keyring,
            owner.id(),
            &existing.memo.creation_id.to_string(),
            canonical,
            &existing.fingerprint,
        )?;
        if !matches {
            return Err(DomainError::safe(
                ErrorCode::CreationIdentifierConflict,
                "creation identifier already belongs to different input",
            )
            .with_existing_memo(existing.memo.id));
        }
        Ok(CreateMoneyMemoResult {
            memo: existing.memo,
            created: false,
        })
    }
}

#[async_trait]
impl CreateMoneyMemo for CreateMoneyMemoService {
    async fn create(
        &self,
        owner: &AuthenticatedOwner,
        candidate: CreateCandidate,
    ) -> Result<CreateMoneyMemoResult, DomainError> {
        self.execute(owner, candidate).await
    }
}
