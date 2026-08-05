//! Owner-scoped Appwrite query construction.

use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_domain::{DomainError, ErrorCode, LabelId, MoneyMemoId};
use serde_json::json;

/// Query builder whose first immutable predicate is always authenticated owner.
pub struct OwnerScope {
    owner_equal: String,
}

impl OwnerScope {
    /// Binds one request to the validated owner capability.
    #[must_use]
    pub fn new(owner: &AuthenticatedOwner) -> Self {
        Self {
            owner_equal: equal("owner_id", owner.id().as_str()),
        }
    }

    /// Targeted Money Memo read.
    #[must_use]
    pub fn memo_target(&self, id: MoneyMemoId) -> Vec<String> {
        self.target("memo_id", &id.to_string())
    }

    /// Money Memo list base.
    #[must_use]
    pub fn memo_list(&self) -> Vec<String> {
        self.list_base()
    }

    /// Targeted Money Memo mutation precondition.
    #[must_use]
    pub fn memo_mutation_target(&self, id: MoneyMemoId) -> Vec<String> {
        self.memo_target(id)
    }

    /// Targeted label read.
    #[must_use]
    pub fn label_target(&self, id: LabelId) -> Vec<String> {
        self.target("label_id", &id.to_string())
    }

    /// Label list base.
    #[must_use]
    pub fn label_list(&self) -> Vec<String> {
        self.list_base()
    }

    /// Targeted label mutation precondition.
    #[must_use]
    pub fn label_mutation_target(&self, id: LabelId) -> Vec<String> {
        self.label_target(id)
    }

    /// Private journal-state lookup.
    #[must_use]
    pub fn journal_target(&self) -> Vec<String> {
        // Owner uniqueness permits at most one row. Keep the bound below Appwrite's GraphQL
        // complexity ceiling even if the invariant is violated, so the adapter can fail closed.
        vec![self.owner_equal.clone(), limit(2)]
    }

    /// Adds a non-owner equality predicate; owner overrides are rejected.
    pub fn extra_equal(&self, attribute: &str, value: &str) -> Result<String, DomainError> {
        if attribute == "owner_id" {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "owner predicate is immutable",
            ));
        }
        Ok(equal(attribute, value))
    }

    fn target(&self, attribute: &str, value: &str) -> Vec<String> {
        vec![self.owner_equal.clone(), equal(attribute, value), limit(2)]
    }

    fn list_base(&self) -> Vec<String> {
        // `rows { data }` costs two GraphQL complexity points per result in Appwrite 1.9.
        vec![self.owner_equal.clone(), limit(100)]
    }
}

/// Encodes one supported equality query.
#[must_use]
pub fn equal(attribute: &str, value: &str) -> String {
    json!({ "method": "equal", "attribute": attribute, "values": [value] }).to_string()
}

/// Encodes one supported page bound.
#[must_use]
pub fn limit(value: u16) -> String {
    json!({ "method": "limit", "values": [value] }).to_string()
}
