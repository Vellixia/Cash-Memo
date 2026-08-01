//! First-compose starter-label seeding through the production query boundary.

use std::sync::{Arc, Mutex, MutexGuard};

use async_trait::async_trait;
use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_application::clock::ManualClock;
use cashmemo_application::ports::LabelRepository;
use cashmemo_application::use_cases::query_label_references::{
    LabelReferenceQuery, OwnerScopedLabelReferenceQuery,
};
use cashmemo_domain::label::{LabelKind, LabelState};
use cashmemo_domain::{DomainError, Label, LabelId, OwnerId, Timestamp};

#[derive(Default)]
struct MemoryLabels(Mutex<Vec<Label>>);

impl MemoryLabels {
    fn lock(&self) -> MutexGuard<'_, Vec<Label>> {
        match self.0.lock() {
            Ok(labels) => labels,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

#[async_trait]
impl LabelRepository for MemoryLabels {
    async fn get(
        &self,
        owner: &AuthenticatedOwner,
        id: LabelId,
    ) -> Result<Option<Label>, DomainError> {
        Ok(self
            .lock()
            .iter()
            .find(|label| &label.owner == owner.id() && label.id == id)
            .cloned())
    }

    async fn list(&self, owner: &AuthenticatedOwner) -> Result<Vec<Label>, DomainError> {
        Ok(self
            .lock()
            .iter()
            .filter(|label| &label.owner == owner.id())
            .cloned()
            .collect())
    }

    async fn create_if_absent(
        &self,
        owner: &AuthenticatedOwner,
        label: &Label,
    ) -> Result<Label, DomainError> {
        let mut labels = self.lock();
        if let Some(existing) = labels.iter().find(|existing| {
            &existing.owner == owner.id()
                && existing.kind == label.kind
                && existing.name_key == label.name_key
        }) {
            return Ok(existing.clone());
        }
        labels.push(label.clone());
        Ok(label.clone())
    }
}

fn owner(value: &str) -> AuthenticatedOwner {
    AuthenticatedOwner::after_account_validation(must(OwnerId::parse_authenticated_account(value)))
}

fn must<T, E>(result: Result<T, E>) -> T {
    let Ok(value) = result else {
        panic!("expected success")
    };
    value
}

#[tokio::test]
async fn first_reference_query_seeds_once_and_keeps_owners_isolated() {
    let now = must(Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z"));
    let repository = Arc::new(MemoryLabels::default());
    let query =
        OwnerScopedLabelReferenceQuery::new(repository.clone(), Arc::new(ManualClock::new(now)));
    let first_owner = owner("owner-a");
    let second_owner = owner("owner-b");

    let categories = must(
        query
            .query(&first_owner, LabelKind::Category, &[LabelState::Active])
            .await,
    );
    let spaces = must(
        query
            .query(&first_owner, LabelKind::MoneySpace, &[LabelState::Active])
            .await,
    );
    let repeated = must(
        query
            .query(&first_owner, LabelKind::Category, &[LabelState::Active])
            .await,
    );
    let other_owner = must(
        query
            .query(&second_owner, LabelKind::Category, &[LabelState::Active])
            .await,
    );

    assert_eq!(categories.len(), 1);
    assert_eq!(categories[0].name, "General");
    assert_eq!(spaces.len(), 1);
    assert_eq!(spaces[0].name, "Personal");
    assert_eq!(repeated[0].id, categories[0].id);
    assert_ne!(other_owner[0].id, categories[0].id);
    assert_eq!(repository.lock().len(), 4);
}
