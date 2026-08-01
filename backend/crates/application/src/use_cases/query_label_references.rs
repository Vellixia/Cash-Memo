//! Owner-scoped label reference query for compose and filters.

use std::sync::Arc;

use async_trait::async_trait;
use cashmemo_domain::label::{LabelKind, LabelState};
use cashmemo_domain::{DomainError, Label};

use crate::authorization::AuthenticatedOwner;
use crate::clock::Clock;
use crate::ports::LabelRepository;
use crate::use_cases::seed_labels::seed_starter_labels;

/// HTTP-facing application capability with no persistence details.
#[async_trait]
pub trait LabelReferenceQuery: Send + Sync {
    /// Lists only labels belonging to `owner` with requested kind/states.
    async fn query(
        &self,
        owner: &AuthenticatedOwner,
        kind: LabelKind,
        states: &[LabelState],
    ) -> Result<Vec<Label>, DomainError>;
}

/// Repository-backed label reference query.
pub struct OwnerScopedLabelReferenceQuery<R> {
    repository: Arc<R>,
    clock: Arc<dyn Clock>,
}

impl<R> OwnerScopedLabelReferenceQuery<R> {
    /// Creates query that ensures starter labels before returning references.
    #[must_use]
    pub fn new(repository: Arc<R>, clock: Arc<dyn Clock>) -> Self {
        Self { repository, clock }
    }
}

#[async_trait]
impl<R> LabelReferenceQuery for OwnerScopedLabelReferenceQuery<R>
where
    R: LabelRepository + 'static,
{
    async fn query(
        &self,
        owner: &AuthenticatedOwner,
        kind: LabelKind,
        states: &[LabelState],
    ) -> Result<Vec<Label>, DomainError> {
        seed_starter_labels(self.repository.as_ref(), owner, self.clock.now()?).await?;
        Ok(self
            .repository
            .list(owner)
            .await?
            .into_iter()
            .filter(|label| label.kind == kind && states.contains(&label.state))
            .collect())
    }
}
