//! Thousand-retry and current-lifecycle idempotency oracle.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_application::clock::ManualClock;
use cashmemo_application::creation_fingerprint::CreationFingerprint;
use cashmemo_application::keyring::{KekKeyring, RuntimeKek};
use cashmemo_application::ports::{
    CreateMemoPersistence, PersistCreationOutcome, PreparedCreation, StoredCreation,
};
use cashmemo_application::use_cases::create_money_memo::CreateMoneyMemoService;
use cashmemo_domain::create::{CreateCandidate, canonical_creation_document, validate_create};
use cashmemo_domain::label::LabelState;
use cashmemo_domain::lifecycle::{Lifecycle, LifecycleStatus};
use cashmemo_domain::money::{Currency, Money};
use cashmemo_domain::money_memo::{LabelReference, MoneyMemoType, PlannedStatus, Purpose};
use cashmemo_domain::{DomainError, LabelId, MoneyMemo, MoneyMemoId, OwnerId, Revision, Timestamp};

fn must<T, E>(result: Result<T, E>) -> T {
    let Ok(value) = result else {
        panic!("expected success")
    };
    value
}

fn candidate() -> CreateCandidate {
    CreateCandidate {
        creation_id: "b4f82dc9-118f-45e4-bbe7-d742f921589f".to_owned(),
        memo_type: Some(MoneyMemoType::Expense),
        amount: "42.50".to_owned(),
        currency: "USD".to_owned(),
        occurrence_instant: "2026-07-30T12:15:00.000000Z".to_owned(),
        occurrence_local_wall: "2026-07-30T19:15:00.000000".to_owned(),
        occurrence_offset: "+07:00".to_owned(),
        category_id: "66ff6d25-01b0-4442-a9fe-0c4fef1f0605".to_owned(),
        money_space_id: "9074bd6a-6959-463a-8a04-88a537d12d57".to_owned(),
        note: Some("Original".to_owned()),
        planned_status: Some(PlannedStatus::Unplanned),
        purpose: Some(Purpose::Personal),
    }
}

struct ExistingStore {
    value: Mutex<StoredCreation>,
    create_calls: AtomicU64,
}

struct ResponseLossStore {
    value: Mutex<Option<StoredCreation>>,
    create_calls: AtomicU64,
}

#[async_trait]
impl CreateMemoPersistence for ResponseLossStore {
    async fn find_creation(
        &self,
        _owner: &AuthenticatedOwner,
        _creation_id: cashmemo_domain::CreationId,
    ) -> Result<Option<StoredCreation>, DomainError> {
        self.value
            .lock()
            .map(|value| value.clone())
            .map_err(|_| {
                DomainError::retryable(
                    cashmemo_domain::ErrorCode::DependencyUnavailable,
                    "test store unavailable",
                )
            })
    }

    async fn create(
        &self,
        owner: &AuthenticatedOwner,
        prepared: &PreparedCreation,
    ) -> Result<PersistCreationOutcome, DomainError> {
        self.create_calls.fetch_add(1, Ordering::SeqCst);
        let memo = MoneyMemo {
            id: prepared.memo_id,
            owner: owner.id().clone(),
            creation_id: prepared.values.creation_id,
            memo_type: prepared.values.memo_type,
            money: prepared.values.money.clone(),
            occurrence: prepared.values.occurrence.clone(),
            category: LabelReference {
                id: prepared.values.category_id,
                name: "General".to_owned(),
                state: LabelState::Active,
            },
            money_space: LabelReference {
                id: prepared.values.money_space_id,
                name: "Personal".to_owned(),
                state: LabelState::Active,
            },
            note: prepared.values.note.clone(),
            planned_status: prepared.values.planned_status,
            purpose: prepared.values.purpose,
            lifecycle: Lifecycle::ACTIVE,
            revision: Revision::INITIAL,
            created_at: prepared.accepted_at,
            updated_at: prepared.accepted_at,
        };
        let stored = StoredCreation {
            memo,
            fingerprint: prepared.fingerprint.clone(),
        };
        self.value
            .lock()
            .map_err(|_| {
                DomainError::retryable(
                    cashmemo_domain::ErrorCode::DependencyUnavailable,
                    "test store unavailable",
                )
            })?
            .replace(stored);
        Err(DomainError::retryable(
            cashmemo_domain::ErrorCode::DependencyUnavailable,
            "mutation response unavailable",
        ))
    }
}

#[async_trait]
impl CreateMemoPersistence for ExistingStore {
    async fn find_creation(
        &self,
        _owner: &AuthenticatedOwner,
        _creation_id: cashmemo_domain::CreationId,
    ) -> Result<Option<StoredCreation>, DomainError> {
        self.value
            .lock()
            .map(|value| Some(value.clone()))
            .map_err(|_| {
                DomainError::retryable(
                    cashmemo_domain::ErrorCode::DependencyUnavailable,
                    "test store unavailable",
                )
            })
    }

    async fn create(
        &self,
        _owner: &AuthenticatedOwner,
        _prepared: &PreparedCreation,
    ) -> Result<PersistCreationOutcome, DomainError> {
        self.create_calls.fetch_add(1, Ordering::SeqCst);
        Err(DomainError::retryable(
            cashmemo_domain::ErrorCode::DependencyUnavailable,
            "unexpected create",
        ))
    }
}

#[tokio::test]
async fn one_thousand_matching_retries_return_current_state_without_writes() {
    let now = must(Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z"));
    let owner_id = must(OwnerId::parse_authenticated_account("owner-a"));
    let owner = AuthenticatedOwner::after_account_validation(owner_id.clone());
    let keyring = Arc::new(must(KekKeyring::new(
        "kek-test-a",
        vec![must(RuntimeKek::new("kek-test-a", [0x51; 32]))],
    )));
    let original = must(validate_create(candidate(), now));
    let canonical = must(canonical_creation_document(&owner_id, &original));
    let fingerprint = must(CreationFingerprint::create(
        &keyring,
        &owner_id,
        &original.creation_id.to_string(),
        &canonical,
    ));
    let store = Arc::new(ExistingStore {
        value: Mutex::new(StoredCreation {
            memo: current_archived_memo(owner_id, &original, now),
            fingerprint,
        }),
        create_calls: AtomicU64::new(0),
    });
    let service =
        CreateMoneyMemoService::new(store.clone(), keyring, Arc::new(ManualClock::new(now)));
    for _ in 0..1_000 {
        let retry = must(service.execute(&owner, candidate()).await);
        assert!(!retry.created);
        assert_eq!(retry.memo.lifecycle.status, LifecycleStatus::Archived);
        assert_eq!(retry.memo.revision.get(), 7);
        assert_eq!(retry.memo.note.as_deref(), Some("Edited later"));
        assert_eq!(retry.memo.money.decimal(), "99.99");
    }
    assert_eq!(store.create_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn response_loss_retry_resolves_persisted_creation_without_second_write() {
    let now = must(Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z"));
    let owner = AuthenticatedOwner::after_account_validation(must(
        OwnerId::parse_authenticated_account("owner-a"),
    ));
    let keyring = Arc::new(must(KekKeyring::new(
        "kek-test-a",
        vec![must(RuntimeKek::new("kek-test-a", [0x52; 32]))],
    )));
    let store = Arc::new(ResponseLossStore {
        value: Mutex::new(None),
        create_calls: AtomicU64::new(0),
    });
    let service = CreateMoneyMemoService::new(
        store.clone(),
        keyring,
        Arc::new(ManualClock::new(now)),
    );

    let first = service.execute(&owner, candidate()).await;
    assert!(first.is_err());
    let retry = must(service.execute(&owner, candidate()).await);
    assert!(!retry.created);
    assert_eq!(retry.memo.revision, Revision::INITIAL);
    assert_eq!(store.create_calls.load(Ordering::SeqCst), 1);
}

fn current_archived_memo(
    owner: OwnerId,
    original: &cashmemo_domain::create::ValidatedCreate,
    now: Timestamp,
) -> MoneyMemo {
    MoneyMemo {
        id: must(MoneyMemoId::parse("f5b77e8f-ae9a-466e-8df4-b0079825f46e")),
        owner,
        creation_id: original.creation_id,
        memo_type: MoneyMemoType::Income,
        money: must(Money::parse("99.99", must(Currency::parse("USD")))),
        occurrence: original.occurrence.clone(),
        category: LabelReference {
            id: must(LabelId::parse("66ff6d25-01b0-4442-a9fe-0c4fef1f0605")),
            name: "General renamed".to_owned(),
            state: LabelState::Active,
        },
        money_space: LabelReference {
            id: must(LabelId::parse("9074bd6a-6959-463a-8a04-88a537d12d57")),
            name: "Personal".to_owned(),
            state: LabelState::Active,
        },
        note: Some("Edited later".to_owned()),
        planned_status: PlannedStatus::Planned,
        purpose: Purpose::Mixed,
        lifecycle: Lifecycle {
            status: LifecycleStatus::Archived,
            pre_delete_status: None,
            deletion_requested_at: None,
            purge_deadline: None,
        },
        revision: must(Revision::new(7)),
        created_at: now,
        updated_at: Timestamp::from_micros(now.as_micros() + 1),
    }
}
