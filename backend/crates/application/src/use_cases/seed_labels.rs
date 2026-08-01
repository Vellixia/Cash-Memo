//! Idempotent per-owner starter Category and Money Space seeding.

use cashmemo_domain::label::{LabelKind, normalized_name};
use cashmemo_domain::{DomainError, Label, LabelId, Timestamp};

use crate::authorization::AuthenticatedOwner;
use crate::ports::LabelRepository;

/// Minimal starter labels that make first compose usable.
pub const STARTER_LABELS: [(LabelKind, &str); 2] = [
    (LabelKind::Category, "General"),
    (LabelKind::MoneySpace, "Personal"),
];

/// Ensures each starter exists once for the authenticated owner.
pub async fn seed_starter_labels<R: LabelRepository>(
    repository: &R,
    owner: &AuthenticatedOwner,
    now: Timestamp,
) -> Result<Vec<Label>, DomainError> {
    let existing = repository.list(owner).await?;
    let mut result = Vec::with_capacity(STARTER_LABELS.len());
    for (kind, name) in STARTER_LABELS {
        let name_key = normalized_name(name);
        if let Some(label) = existing
            .iter()
            .find(|label| label.kind == kind && label.name_key == name_key)
        {
            result.push(label.clone());
            continue;
        }
        let candidate = Label::new(LabelId::random(), owner.id().clone(), kind, name, now)?;
        result.push(repository.create_if_absent(owner, &candidate).await?);
    }
    Ok(result)
}
