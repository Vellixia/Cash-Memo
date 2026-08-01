//! Deterministic private per-owner journal state access.

use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_domain::{DomainError, ErrorCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::AppwriteClient;
use crate::query::OwnerScope;

const HEX: &[u8; 16] = b"0123456789abcdef";

/// Per-owner generation and export-fence persistence.
#[derive(Clone, Debug)]
pub struct JournalStateStore {
    client: AppwriteClient,
}

/// Per-owner list/export generations participating in each mutation transaction.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct JournalGenerations {
    /// Every export-visible mutation.
    pub mutation: i64,
    /// Create/archive/restore/delete/purge/occurrence membership/order changes.
    pub base_result: i64,
    /// Search shadow changes.
    pub note_search: i64,
    /// Type filter changes.
    pub memo_type: i64,
    /// Currency filter changes.
    pub currency: i64,
    /// Category filter changes.
    pub category: i64,
    /// Money Space filter changes.
    pub money_space: i64,
    /// Planned-status filter changes.
    pub planned_status: i64,
    /// Purpose filter changes.
    pub purpose: i64,
}

impl JournalStateStore {
    /// Creates store over supported APIs.
    #[must_use]
    pub const fn new(client: AppwriteClient) -> Self {
        Self { client }
    }

    /// Opaque deterministic row ID; owner text is not embedded.
    #[must_use]
    pub fn private_row_id(owner: &AuthenticatedOwner) -> String {
        let mut digest = Sha256::new();
        digest.update(b"cashmemo:user-journal-state:v1\0");
        digest.update(owner.id().as_str().as_bytes());
        let bytes = digest.finalize();
        let mut encoded = String::with_capacity(32);
        for byte in &bytes[..16] {
            encoded.push(char::from(HEX[usize::from(byte >> 4)]));
            encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
        encoded
    }

    /// Loads only the authenticated owner's state using an owner predicate.
    pub async fn get_raw(&self, owner: &AuthenticatedOwner) -> Result<Option<Value>, DomainError> {
        self.get_raw_in_transaction(owner, None).await
    }

    /// Loads state inside the same supported transaction that will update it.
    pub async fn get_raw_in_transaction(
        &self,
        owner: &AuthenticatedOwner,
        transaction_id: Option<&str>,
    ) -> Result<Option<Value>, DomainError> {
        let mut rows = self
            .client
            .list_rows(
                "user_journal_state",
                &OwnerScope::new(owner).journal_target(),
                transaction_id,
            )
            .await
            .map_err(|_| {
                DomainError::retryable(ErrorCode::DependencyUnavailable, "persistence unavailable")
            })?;
        if rows.len() > 1 {
            return Err(DomainError::retryable(
                ErrorCode::DependencyUnavailable,
                "persistence invariant unavailable",
            ));
        }
        Ok(rows.pop())
    }

    /// Reads the current generation projection for the authenticated owner.
    pub async fn generations(
        &self,
        owner: &AuthenticatedOwner,
    ) -> Result<JournalGenerations, DomainError> {
        self.get_raw(owner)
            .await?
            .as_ref()
            .map(map_generations)
            .transpose()
            .map(Option::unwrap_or_default)
    }

    /// Stages owner-bound create/update in an existing supported transaction.
    pub async fn stage_generations(
        &self,
        owner: &AuthenticatedOwner,
        transaction_id: &str,
        generations: JournalGenerations,
    ) -> Result<(), DomainError> {
        let existing = self
            .get_raw_in_transaction(owner, Some(transaction_id))
            .await?;
        let mut data = serde_json::Map::new();
        data.insert(
            "mutation_generation".to_owned(),
            json!(generations.mutation),
        );
        data.insert(
            "base_result_generation".to_owned(),
            json!(generations.base_result),
        );
        data.insert(
            "note_search_generation".to_owned(),
            json!(generations.note_search),
        );
        data.insert("type_generation".to_owned(), json!(generations.memo_type));
        data.insert(
            "currency_generation".to_owned(),
            json!(generations.currency),
        );
        data.insert(
            "category_generation".to_owned(),
            json!(generations.category),
        );
        data.insert(
            "money_space_generation".to_owned(),
            json!(generations.money_space),
        );
        data.insert(
            "planned_status_generation".to_owned(),
            json!(generations.planned_status),
        );
        data.insert("purpose_generation".to_owned(), json!(generations.purpose));
        let row_id = Self::private_row_id(owner);
        let operation = if existing.is_some() {
            json!({
                "databaseId": self.client.database_id(), "tableId": "user_journal_state",
                "action": "update", "rowId": row_id, "data": data
            })
        } else {
            data.insert("owner_id".to_owned(), json!(owner.id().as_str()));
            json!({
                "databaseId": self.client.database_id(), "tableId": "user_journal_state",
                "action": "create", "rowId": row_id, "data": data
            })
        };
        self.client
            .stage_operations(transaction_id, vec![operation])
            .await
            .map_err(|_| {
                DomainError::retryable(ErrorCode::DependencyUnavailable, "persistence unavailable")
            })
    }
}

fn map_generations(value: &Value) -> Result<JournalGenerations, DomainError> {
    Ok(JournalGenerations {
        mutation: generation(value, "mutation_generation")?,
        base_result: generation(value, "base_result_generation")?,
        note_search: generation(value, "note_search_generation")?,
        memo_type: generation(value, "type_generation")?,
        currency: generation(value, "currency_generation")?,
        category: generation(value, "category_generation")?,
        money_space: generation(value, "money_space_generation")?,
        planned_status: generation(value, "planned_status_generation")?,
        purpose: generation(value, "purpose_generation")?,
    })
}

fn generation(value: &Value, field: &str) -> Result<i64, DomainError> {
    value
        .get(field)
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(|| {
            DomainError::retryable(
                ErrorCode::DependencyUnavailable,
                "persistence invariant unavailable",
            )
        })
}
