//! Narrow inward-owned adapter contracts.

use async_trait::async_trait;
use cashmemo_domain::create::ValidatedCreate;
use cashmemo_domain::{CreationId, DomainError, Label, LabelId, MoneyMemo, MoneyMemoId, Timestamp};

use crate::authorization::{AuthenticatedOwner, ReconcileCapability, WorkerCapability};
use crate::creation_fingerprint::FingerprintEnvelope;

/// Owner-scoped memo persistence.
#[async_trait]
pub trait MoneyMemoRepository: Send + Sync {
    /// Gets same-owner memo or indistinguishable not-found.
    async fn get(
        &self,
        owner: &AuthenticatedOwner,
        id: MoneyMemoId,
    ) -> Result<Option<MoneyMemo>, DomainError>;

    /// Lists same-owner memos only.
    async fn list(&self, owner: &AuthenticatedOwner) -> Result<Vec<MoneyMemo>, DomainError>;

    /// Persists only when the mutation predicate includes the authenticated owner.
    async fn put(&self, owner: &AuthenticatedOwner, memo: &MoneyMemo) -> Result<(), DomainError>;

    /// Worker scan uses a separate capability and cannot impersonate a user.
    async fn scan_expired(&self, worker: WorkerCapability) -> Result<Vec<MoneyMemo>, DomainError>;

    /// Restore scan uses a separate capability and cannot impersonate a user.
    async fn scan_restored(
        &self,
        reconcile: ReconcileCapability,
    ) -> Result<Vec<MoneyMemo>, DomainError>;
}

/// Owner-scoped label persistence.
#[async_trait]
pub trait LabelRepository: Send + Sync {
    /// Gets same-owner label or indistinguishable not-found.
    async fn get(
        &self,
        owner: &AuthenticatedOwner,
        id: LabelId,
    ) -> Result<Option<Label>, DomainError>;

    /// Lists same-owner labels only.
    async fn list(&self, owner: &AuthenticatedOwner) -> Result<Vec<Label>, DomainError>;

    /// Inserts a same-owner label or returns the existing normalized-name winner.
    async fn create_if_absent(
        &self,
        owner: &AuthenticatedOwner,
        label: &Label,
    ) -> Result<Label, DomainError>;
}

/// Atomic persistence boundary.
#[async_trait]
pub trait UnitOfWork: Send + Sync {
    /// Opaque transaction handle type.
    type Transaction: Send;
    /// Starts supported Appwrite transaction.
    async fn begin(&self) -> Result<Self::Transaction, DomainError>;
    /// Commits transaction atomically.
    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DomainError>;
}

/// Export fence coordination port.
pub trait ExportFence: Send + Sync {}
/// Independent deletion-suppression storage port.
pub trait SuppressionLedger: Send + Sync {}
/// Backup inventory/destruction-verification port.
pub trait BackupInventory: Send + Sync {}
/// Fingerprint and runtime key access port.
pub trait Keyring: Send + Sync {}

/// Existing immutable creation proof plus current memo projection.
#[derive(Clone)]
pub struct StoredCreation {
    /// Current lifecycle/revision/fields.
    pub memo: MoneyMemo,
    /// Immutable fingerprint security metadata.
    pub fingerprint: FingerprintEnvelope,
}

impl std::fmt::Debug for StoredCreation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("StoredCreation([REDACTED])")
    }
}

/// Validated creation ready for one atomic persistence attempt.
pub struct PreparedCreation {
    /// New public memo ID.
    pub memo_id: MoneyMemoId,
    /// Validated user fields.
    pub values: ValidatedCreate,
    /// Immutable keyed creation proof.
    pub fingerprint: FingerprintEnvelope,
    /// Server acceptance instant.
    pub accepted_at: Timestamp,
}

impl std::fmt::Debug for PreparedCreation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PreparedCreation([REDACTED])")
    }
}

/// Atomic create winner or uniqueness-race winner.
pub enum PersistCreationOutcome {
    /// This attempt committed the new memo.
    Created(MoneyMemo),
    /// Another request already owns `(owner, creation_id)`.
    Existing(StoredCreation),
}

/// Owner-scoped create and immutable retry lookup.
#[async_trait]
pub trait CreateMemoPersistence: Send + Sync {
    /// Finds an existing creation without exposing other-owner rows.
    async fn find_creation(
        &self,
        owner: &AuthenticatedOwner,
        creation_id: CreationId,
    ) -> Result<Option<StoredCreation>, DomainError>;

    /// Atomically validates references/counts/fence, updates journal, and inserts once.
    async fn create(
        &self,
        owner: &AuthenticatedOwner,
        prepared: &PreparedCreation,
    ) -> Result<PersistCreationOutcome, DomainError>;
}

/// Allowlisted telemetry only.
pub trait Telemetry: Send + Sync {
    /// Emits safe operation code and aggregate count, never resource/owner/content IDs.
    fn operation(&self, code: &'static str, count: u64);
}
