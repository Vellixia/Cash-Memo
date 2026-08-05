//! Atomic supported-API Money Memo creation and uniqueness-race resolution.

use async_trait::async_trait;
use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_application::creation_fingerprint::FingerprintEnvelope;
use cashmemo_application::ports::{
    CreateMemoPersistence, PersistCreationOutcome, PreparedCreation, StoredCreation,
};
use cashmemo_domain::create::{enum_planned, enum_purpose, enum_type};
use cashmemo_domain::label::{LabelKind, LabelState};
use cashmemo_domain::lifecycle::{Lifecycle, LifecycleStatus};
use cashmemo_domain::money::{Currency, Money};
use cashmemo_domain::money_memo::{LabelReference, MoneyMemoType, PlannedStatus, Purpose};
use cashmemo_domain::occurrence::{LocalWall, Occurrence, UtcOffset, ZoneResolution};
use cashmemo_domain::{
    CreationId, DomainError, ErrorCode, LabelId, MoneyMemo, MoneyMemoId, OwnerId, Revision,
    Timestamp,
};
use serde_json::{Value, json};

use crate::journal_state_repository::{JournalGenerations, JournalStateStore};
use crate::query::OwnerScope;
use crate::{AppwriteClient, AppwriteError};

/// Owner-scoped atomic creation store.
#[derive(Clone, Debug)]
pub struct CreateMoneyMemoStore {
    client: AppwriteClient,
}

impl CreateMoneyMemoStore {
    /// Creates store over supported `TablesDB` APIs.
    #[must_use]
    pub const fn new(client: AppwriteClient) -> Self {
        Self { client }
    }

    async fn find_raw(
        &self,
        owner: &AuthenticatedOwner,
        creation_id: CreationId,
        transaction_id: Option<&str>,
    ) -> Result<Option<Value>, DomainError> {
        let scope = OwnerScope::new(owner);
        let mut queries = scope.memo_list();
        queries.push(scope.extra_equal("creation_id", &creation_id.to_string())?);
        let mut rows = self
            .client
            .list_rows("money_memos", &queries, transaction_id)
            .await
            .map_err(map_dependency)?;
        if rows.len() > 1 {
            return Err(invariant());
        }
        Ok(rows.pop())
    }

    async fn map_stored(
        &self,
        owner: &AuthenticatedOwner,
        row: &Value,
    ) -> Result<StoredCreation, DomainError> {
        let category = self
            .label_reference(
                owner,
                LabelId::parse(required_str(row, "category_id")?)?,
                None,
            )
            .await?;
        let money_space = self
            .label_reference(
                owner,
                LabelId::parse(required_str(row, "money_space_id")?)?,
                None,
            )
            .await?;
        Ok(StoredCreation {
            memo: map_memo(owner, row, category, money_space)?,
            fingerprint: FingerprintEnvelope {
                mac_hex: required_str(row, "creation_fingerprint")?.to_owned(),
                wrapped_key_ciphertext: required_str(row, "fingerprint_key_ciphertext")?.to_owned(),
                wrapped_key_nonce: required_str(row, "fingerprint_key_nonce")?.to_owned(),
                kek_id: required_str(row, "fingerprint_kek_id")?.to_owned(),
            },
        })
    }

    async fn label_reference(
        &self,
        owner: &AuthenticatedOwner,
        id: LabelId,
        transaction_id: Option<&str>,
    ) -> Result<TransactionalLabel, DomainError> {
        let mut rows = self
            .client
            .list_rows(
                "labels",
                &OwnerScope::new(owner).label_target(id),
                transaction_id,
            )
            .await
            .map_err(map_dependency)?;
        if rows.len() != 1 {
            return Err(DomainError::safe(ErrorCode::NotFound, "resource not found"));
        }
        let row = rows.pop().ok_or_else(invariant)?;
        let persisted_owner =
            OwnerId::parse_authenticated_account(required_str(&row, "owner_id")?)?;
        if &persisted_owner != owner.id() {
            return Err(DomainError::safe(ErrorCode::NotFound, "resource not found"));
        }
        let kind = match required_str(&row, "kind")? {
            "category" => LabelKind::Category,
            "money_space" => LabelKind::MoneySpace,
            _ => return Err(invariant()),
        };
        let state = match required_str(&row, "state")? {
            "active" => LabelState::Active,
            "deactivated" => LabelState::Deactivated,
            _ => return Err(invariant()),
        };
        let reference_count = required_i64(&row, "memo_reference_count")?;
        if reference_count < 0 {
            return Err(invariant());
        }
        Ok(TransactionalLabel {
            reference: LabelReference {
                id,
                name: required_str(&row, "name")?.to_owned(),
                state,
            },
            kind,
            reference_count,
        })
    }

    async fn current_generations(
        &self,
        owner: &AuthenticatedOwner,
        transaction_id: &str,
        accepted_at: Timestamp,
    ) -> Result<JournalGenerations, DomainError> {
        let journal = JournalStateStore::new(self.client.clone());
        let row = journal
            .get_raw_in_transaction(owner, Some(transaction_id))
            .await?;
        if let Some(row) = &row {
            let lease = row.get("export_lease_id").and_then(Value::as_str);
            let deadline = row.get("export_lease_deadline_us").and_then(Value::as_i64);
            if lease.is_some() && deadline.is_some_and(|value| value > accepted_at.as_micros()) {
                return Err(DomainError::retryable(
                    ErrorCode::ExportInProgress,
                    "export in progress",
                ));
            }
        }
        let value = |field: &str| -> Result<i64, DomainError> {
            row.as_ref().map_or(Ok(0), |current| {
                current
                    .get(field)
                    .and_then(Value::as_i64)
                    .filter(|number| *number >= 0)
                    .ok_or_else(invariant)
            })
        };
        Ok(JournalGenerations {
            mutation: increment(value("mutation_generation")?)?,
            base_result: increment(value("base_result_generation")?)?,
            note_search: increment(value("note_search_generation")?)?,
            memo_type: increment(value("type_generation")?)?,
            currency: increment(value("currency_generation")?)?,
            category: increment(value("category_generation")?)?,
            money_space: increment(value("money_space_generation")?)?,
            planned_status: increment(value("planned_status_generation")?)?,
            purpose: increment(value("purpose_generation")?)?,
        })
    }
}

#[async_trait]
impl CreateMemoPersistence for CreateMoneyMemoStore {
    async fn find_creation(
        &self,
        owner: &AuthenticatedOwner,
        creation_id: CreationId,
    ) -> Result<Option<StoredCreation>, DomainError> {
        match self.find_raw(owner, creation_id, None).await? {
            Some(row) => self.map_stored(owner, &row).await.map(Some),
            None => Ok(None),
        }
    }

    async fn create(
        &self,
        owner: &AuthenticatedOwner,
        prepared: &PreparedCreation,
    ) -> Result<PersistCreationOutcome, DomainError> {
        let transaction_id = self
            .client
            .create_transaction(60)
            .await
            .map_err(map_dependency)?;
        if let Some(row) = self
            .find_raw(owner, prepared.values.creation_id, Some(&transaction_id))
            .await?
        {
            self.client
                .rollback_transaction(&transaction_id)
                .await
                .map_err(map_dependency)?;
            return self
                .map_stored(owner, &row)
                .await
                .map(PersistCreationOutcome::Existing);
        }
        let category = self
            .label_reference(owner, prepared.values.category_id, Some(&transaction_id))
            .await?;
        let money_space = self
            .label_reference(owner, prepared.values.money_space_id, Some(&transaction_id))
            .await?;
        if category.kind != LabelKind::Category
            || money_space.kind != LabelKind::MoneySpace
            || category.reference.state != LabelState::Active
            || money_space.reference.state != LabelState::Active
        {
            return Err(DomainError::safe(
                ErrorCode::ValidationFailed,
                "active label reference required",
            ));
        }
        let generations = self
            .current_generations(owner, &transaction_id, prepared.accepted_at)
            .await?;
        let memo = make_memo(
            owner,
            prepared,
            category.reference.clone(),
            money_space.reference.clone(),
        );
        let operations = vec![
            label_count_operation(
                self.client.database_id(),
                category.reference.id,
                category.reference_count,
            )?,
            label_count_operation(
                self.client.database_id(),
                money_space.reference.id,
                money_space.reference_count,
            )?,
            memo_operation(self.client.database_id(), owner, prepared),
        ];
        self.client
            .stage_operations(&transaction_id, operations)
            .await
            .map_err(map_dependency)?;
        JournalStateStore::new(self.client.clone())
            .stage_generations(owner, &transaction_id, generations)
            .await?;
        match self.client.commit_transaction(&transaction_id).await {
            Ok(()) => Ok(PersistCreationOutcome::Created(memo)),
            Err(AppwriteError::Conflict) => {
                let existing = self
                    .find_creation(owner, prepared.values.creation_id)
                    .await?
                    .ok_or_else(|| {
                        DomainError::retryable(
                            ErrorCode::DependencyUnavailable,
                            "creation race unavailable",
                        )
                    })?;
                Ok(PersistCreationOutcome::Existing(existing))
            }
            Err(error) => Err(map_dependency(error)),
        }
    }
}

#[derive(Clone)]
struct TransactionalLabel {
    reference: LabelReference,
    kind: LabelKind,
    reference_count: i64,
}

fn label_count_operation(database_id: &str, id: LabelId, count: i64) -> Result<Value, DomainError> {
    Ok(json!({
        "databaseId": database_id,
        "tableId": "labels",
        "action": "update",
        "rowId": id.to_string(),
        "data": { "memo_reference_count": increment(count)? }
    }))
}

fn memo_operation(
    database_id: &str,
    owner: &AuthenticatedOwner,
    prepared: &PreparedCreation,
) -> Value {
    let value = &prepared.values;
    json!({
        "databaseId": database_id,
        "tableId": "money_memos",
        "action": "create",
        "rowId": prepared.memo_id.to_string(),
        "data": {
            "memo_id": prepared.memo_id.to_string(),
            "owner_id": owner.id().as_str(),
            "memo_type": enum_type(value.memo_type),
            "amount_minor": value.money.minor(),
            "amount_scale": value.money.currency().scale(),
            "currency": value.money.currency().code(),
            "occurrence_instant_us": value.occurrence.instant().as_micros(),
            "occurrence_local_wall": value.occurrence.wall().canonical(),
            "occurrence_local_date": value.occurrence.local_date().to_string(),
            "occurrence_offset_minutes": value.occurrence.offset().minutes(),
            "category_id": value.category_id.to_string(),
            "money_space_id": value.money_space_id.to_string(),
            "note": value.note,
            "planned_status": enum_planned(value.planned_status),
            "purpose": enum_purpose(value.purpose),
            "lifecycle_status": "active",
            "revision": 1,
            "creation_id": value.creation_id.to_string(),
            "creation_fingerprint": prepared.fingerprint.mac_hex,
            "fingerprint_key_ciphertext": prepared.fingerprint.wrapped_key_ciphertext,
            "fingerprint_key_nonce": prepared.fingerprint.wrapped_key_nonce,
            "fingerprint_kek_id": prepared.fingerprint.kek_id,
            "created_at_us": prepared.accepted_at.as_micros(),
            "updated_at_us": prepared.accepted_at.as_micros()
        }
    })
}

fn make_memo(
    owner: &AuthenticatedOwner,
    prepared: &PreparedCreation,
    category: LabelReference,
    money_space: LabelReference,
) -> MoneyMemo {
    MoneyMemo {
        id: prepared.memo_id,
        owner: owner.id().clone(),
        creation_id: prepared.values.creation_id,
        memo_type: prepared.values.memo_type,
        money: prepared.values.money.clone(),
        occurrence: prepared.values.occurrence.clone(),
        category,
        money_space,
        note: prepared.values.note.clone(),
        planned_status: prepared.values.planned_status,
        purpose: prepared.values.purpose,
        lifecycle: Lifecycle::ACTIVE,
        revision: Revision::INITIAL,
        created_at: prepared.accepted_at,
        updated_at: prepared.accepted_at,
    }
}

fn map_memo(
    owner: &AuthenticatedOwner,
    row: &Value,
    category: TransactionalLabel,
    money_space: TransactionalLabel,
) -> Result<MoneyMemo, DomainError> {
    let persisted_owner = OwnerId::parse_authenticated_account(required_str(row, "owner_id")?)?;
    if &persisted_owner != owner.id() {
        return Err(DomainError::safe(ErrorCode::NotFound, "resource not found"));
    }
    let currency = Currency::parse(required_str(row, "currency")?)?;
    let scale: u8 = required_i64(row, "amount_scale")?
        .try_into()
        .map_err(|_| invariant())?;
    if currency.scale() != scale {
        return Err(invariant());
    }
    let minor: u64 = required_i64(row, "amount_minor")?
        .try_into()
        .map_err(|_| invariant())?;
    let money = Money::parse(&decimal(minor, scale), currency)?;
    let occurrence = Occurrence::new(
        Timestamp::from_micros(required_i64(row, "occurrence_instant_us")?),
        LocalWall::parse(required_str(row, "occurrence_local_wall")?)?,
        UtcOffset::from_minutes(
            required_i64(row, "occurrence_offset_minutes")?
                .try_into()
                .map_err(|_| invariant())?,
        )?,
        ZoneResolution::Unique,
    )?;
    let lifecycle = match required_str(row, "lifecycle_status")? {
        "active" => Lifecycle::ACTIVE,
        "archived" => Lifecycle {
            status: LifecycleStatus::Archived,
            pre_delete_status: None,
            deletion_requested_at: None,
            purge_deadline: None,
        },
        "pending_deletion" => Lifecycle {
            status: LifecycleStatus::PendingDeletion,
            pre_delete_status: match optional_str(row, "pre_delete_status") {
                Some("active") => Some(LifecycleStatus::Active),
                Some("archived") => Some(LifecycleStatus::Archived),
                _ => return Err(invariant()),
            },
            deletion_requested_at: Some(Timestamp::from_micros(required_i64(
                row,
                "deletion_requested_at_us",
            )?)),
            purge_deadline: Some(Timestamp::from_micros(required_i64(
                row,
                "purge_deadline_us",
            )?)),
        },
        _ => return Err(invariant()),
    };
    MoneyMemo {
        id: MoneyMemoId::parse(required_str(row, "memo_id")?)?,
        owner: persisted_owner,
        creation_id: CreationId::parse(required_str(row, "creation_id")?)?,
        memo_type: parse_type(required_str(row, "memo_type")?)?,
        money,
        occurrence,
        category: category.reference,
        money_space: money_space.reference,
        note: optional_str(row, "note").map(str::to_owned),
        planned_status: parse_planned(required_str(row, "planned_status")?)?,
        purpose: parse_purpose(required_str(row, "purpose")?)?,
        lifecycle,
        revision: Revision::new(required_i64(row, "revision")?)?,
        created_at: Timestamp::from_micros(required_i64(row, "created_at_us")?),
        updated_at: Timestamp::from_micros(required_i64(row, "updated_at_us")?),
    }
    .validate()
}

fn decimal(minor: u64, scale: u8) -> String {
    if scale == 0 {
        return minor.to_string();
    }
    let factor = 10_u64.pow(u32::from(scale));
    format!(
        "{}.{:0width$}",
        minor / factor,
        minor % factor,
        width = usize::from(scale)
    )
}

fn parse_type(value: &str) -> Result<MoneyMemoType, DomainError> {
    match value {
        "income" => Ok(MoneyMemoType::Income),
        "expense" => Ok(MoneyMemoType::Expense),
        _ => Err(invariant()),
    }
}

fn parse_planned(value: &str) -> Result<PlannedStatus, DomainError> {
    match value {
        "planned" => Ok(PlannedStatus::Planned),
        "unplanned" => Ok(PlannedStatus::Unplanned),
        _ => Err(invariant()),
    }
}

fn parse_purpose(value: &str) -> Result<Purpose, DomainError> {
    match value {
        "personal" => Ok(Purpose::Personal),
        "work" => Ok(Purpose::Work),
        "mixed" => Ok(Purpose::Mixed),
        _ => Err(invariant()),
    }
}

fn required_str<'a>(value: &'a Value, field: &str) -> Result<&'a str, DomainError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(invariant)
}

fn optional_str<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}

fn required_i64(value: &Value, field: &str) -> Result<i64, DomainError> {
    value
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(invariant)
}

fn increment(value: i64) -> Result<i64, DomainError> {
    value.checked_add(1).ok_or_else(invariant)
}

fn invariant() -> DomainError {
    DomainError::retryable(
        ErrorCode::DependencyUnavailable,
        "persistence invariant unavailable",
    )
}

fn map_dependency(error: AppwriteError) -> DomainError {
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
