//! Owner-scoped Money Memo `TablesDB` access.

use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_domain::{DomainError, ErrorCode, MoneyMemoId};
use serde_json::Value;

use crate::client::{AppwriteClient, AppwriteError};
use crate::query::OwnerScope;

/// Money Memo persistence adapter.
#[derive(Clone, Debug)]
pub struct MoneyMemoStore {
    client: AppwriteClient,
}

impl MoneyMemoStore {
    /// Creates store over supported APIs.
    #[must_use]
    pub const fn new(client: AppwriteClient) -> Self {
        Self { client }
    }

    /// Finds only a same-owner row; other-owner and unknown both return `None`.
    pub async fn find_raw(
        &self,
        owner: &AuthenticatedOwner,
        id: MoneyMemoId,
    ) -> Result<Option<Value>, String> {
        let rows = self
            .client
            .list_rows("money_memos", &OwnerScope::new(owner).memo_target(id), None)
            .await
            .map_err(safe_error)?;
        unique_or_absent(rows)
    }

    /// Lists owner rows with only adapter-owned extra predicates.
    pub async fn list_raw(
        &self,
        owner: &AuthenticatedOwner,
        extra_queries: &[String],
    ) -> Result<Vec<Value>, DomainError> {
        let mut queries = OwnerScope::new(owner).memo_list();
        queries.extend_from_slice(extra_queries);
        self.client
            .list_rows("money_memos", &queries, None)
            .await
            .map_err(map_domain_error)
    }
}

fn unique_or_absent(mut rows: Vec<Value>) -> Result<Option<Value>, String> {
    if rows.len() > 1 {
        return Err("owner-scoped unique lookup returned duplicate rows".to_owned());
    }
    Ok(rows.pop())
}

fn safe_error(error: AppwriteError) -> String {
    match error {
        AppwriteError::Unauthorized => "Appwrite authorization failed",
        AppwriteError::NotFound => "Appwrite resource unavailable",
        AppwriteError::Conflict => "Appwrite conflict",
        AppwriteError::InvalidRequest => "Appwrite supported query rejected",
        AppwriteError::Unavailable => "Appwrite dependency unavailable",
    }
    .to_owned()
}

fn map_domain_error(error: AppwriteError) -> DomainError {
    match error {
        AppwriteError::Unauthorized => {
            DomainError::safe(ErrorCode::AuthRequired, "authentication required")
        }
        AppwriteError::NotFound => DomainError::safe(ErrorCode::NotFound, "resource not found"),
        AppwriteError::Conflict => {
            DomainError::safe(ErrorCode::RevisionConflict, "resource changed")
        }
        AppwriteError::InvalidRequest | AppwriteError::Unavailable => {
            DomainError::retryable(ErrorCode::DependencyUnavailable, "persistence unavailable")
        }
    }
}
