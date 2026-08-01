//! Owner-scoped label `TablesDB` access.

use async_trait::async_trait;
use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_application::ports::LabelRepository;
use cashmemo_domain::label::{LabelKind, LabelState};
use cashmemo_domain::{DomainError, ErrorCode, Label, LabelId, OwnerId, Revision, Timestamp};
use reqwest::Method;
use serde_json::{Value, json};

use crate::query::OwnerScope;
use crate::{AppwriteClient, AppwriteError};

/// Category and Money Space persistence adapter.
#[derive(Clone, Debug)]
pub struct LabelStore {
    client: AppwriteClient,
}

#[async_trait]
impl LabelRepository for LabelStore {
    async fn get(
        &self,
        owner: &AuthenticatedOwner,
        id: LabelId,
    ) -> Result<Option<Label>, DomainError> {
        self.find_raw(owner, id)
            .await?
            .map(|value| map_label(&value, owner))
            .transpose()
    }

    async fn list(&self, owner: &AuthenticatedOwner) -> Result<Vec<Label>, DomainError> {
        self.list_raw(owner)
            .await?
            .iter()
            .map(|value| map_label(value, owner))
            .collect()
    }

    async fn create_if_absent(
        &self,
        owner: &AuthenticatedOwner,
        label: &Label,
    ) -> Result<Label, DomainError> {
        if &label.owner != owner.id() {
            return Err(DomainError::safe(ErrorCode::NotFound, "resource not found"));
        }
        let payload = json!({
            "rowId": label.id.to_string(),
            "data": {
                "label_id": label.id.to_string(),
                "owner_id": owner.id().as_str(),
                "kind": match label.kind { LabelKind::Category => "category", LabelKind::MoneySpace => "money_space" },
                "name": label.name,
                "name_key": label.name_key,
                "state": match label.state { LabelState::Active => "active", LabelState::Deactivated => "deactivated" },
                "memo_reference_count": label.memo_reference_count,
                "revision": label.revision.get(),
                "created_at_us": label.created_at.as_micros(),
                "updated_at_us": label.updated_at.as_micros()
            }
        });
        match self
            .client
            .server_json(
                Method::POST,
                &format!("/tablesdb/{}/tables/labels/rows", self.client.database_id()),
                Some(payload),
            )
            .await
        {
            Ok(value) => map_label(&value, owner),
            Err(AppwriteError::Conflict) => self
                .list(owner)
                .await?
                .into_iter()
                .find(|existing| existing.kind == label.kind && existing.name_key == label.name_key)
                .ok_or_else(|| {
                    DomainError::safe(ErrorCode::LabelNameConflict, "label name already exists")
                }),
            Err(_) => Err(DomainError::retryable(
                ErrorCode::DependencyUnavailable,
                "persistence unavailable",
            )),
        }
    }
}

fn map_label(value: &Value, owner: &AuthenticatedOwner) -> Result<Label, DomainError> {
    let persisted_owner = OwnerId::parse_authenticated_account(required_str(value, "owner_id")?)?;
    if &persisted_owner != owner.id() {
        return Err(DomainError::safe(ErrorCode::NotFound, "resource not found"));
    }
    Ok(Label {
        id: LabelId::parse(required_str(value, "label_id")?)?,
        owner: persisted_owner,
        kind: match required_str(value, "kind")? {
            "category" => LabelKind::Category,
            "money_space" => LabelKind::MoneySpace,
            _ => return Err(persistence_invariant()),
        },
        name: required_str(value, "name")?.to_owned(),
        name_key: required_str(value, "name_key")?.to_owned(),
        state: match required_str(value, "state")? {
            "active" => LabelState::Active,
            "deactivated" => LabelState::Deactivated,
            _ => return Err(persistence_invariant()),
        },
        memo_reference_count: required_i64(value, "memo_reference_count")?
            .try_into()
            .map_err(|_| persistence_invariant())?,
        revision: Revision::new(required_i64(value, "revision")?)?,
        created_at: Timestamp::from_micros(required_i64(value, "created_at_us")?),
        updated_at: Timestamp::from_micros(required_i64(value, "updated_at_us")?),
    })
}

fn required_str<'a>(value: &'a Value, field: &str) -> Result<&'a str, DomainError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(persistence_invariant)
}

fn required_i64(value: &Value, field: &str) -> Result<i64, DomainError> {
    value
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(persistence_invariant)
}

fn persistence_invariant() -> DomainError {
    DomainError::retryable(
        ErrorCode::DependencyUnavailable,
        "persistence invariant unavailable",
    )
}

impl LabelStore {
    /// Creates store over supported APIs.
    #[must_use]
    pub const fn new(client: AppwriteClient) -> Self {
        Self { client }
    }

    /// Finds only a same-owner label.
    pub async fn find_raw(
        &self,
        owner: &AuthenticatedOwner,
        id: LabelId,
    ) -> Result<Option<Value>, DomainError> {
        let mut rows = self
            .client
            .list_rows("labels", &OwnerScope::new(owner).label_target(id), None)
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

    /// Lists same-owner labels.
    pub async fn list_raw(&self, owner: &AuthenticatedOwner) -> Result<Vec<Value>, DomainError> {
        self.client
            .list_rows("labels", &OwnerScope::new(owner).label_list(), None)
            .await
            .map_err(|_| {
                DomainError::retryable(ErrorCode::DependencyUnavailable, "persistence unavailable")
            })
    }

    /// Mutation scaffold that checks owner scope before changing mutable fields only.
    pub async fn rename_raw(
        &self,
        owner: &AuthenticatedOwner,
        id: LabelId,
        name: &str,
        name_key: &str,
    ) -> Result<(), DomainError> {
        if self.find_raw(owner, id).await?.is_none() {
            return Err(DomainError::safe(ErrorCode::NotFound, "resource not found"));
        }
        self.client
            .server_json(
                Method::PATCH,
                &format!(
                    "/tablesdb/{}/tables/labels/rows/{id}",
                    self.client.database_id()
                ),
                Some(json!({ "data": { "name": name, "name_key": name_key } })),
            )
            .await
            .map(|_| ())
            .map_err(|error| match error {
                AppwriteError::NotFound => {
                    DomainError::safe(ErrorCode::NotFound, "resource not found")
                }
                AppwriteError::Conflict => {
                    DomainError::safe(ErrorCode::LabelNameConflict, "label name already exists")
                }
                _ => DomainError::retryable(
                    ErrorCode::DependencyUnavailable,
                    "persistence unavailable",
                ),
            })
    }
}
