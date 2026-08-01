//! Real Appwrite session and cross-user read/list/mutation matrix.

mod support;

use cashmemo_application::authorization::{AuthenticatedOwner, SessionValidator};
use cashmemo_application::ports::LabelRepository;
use cashmemo_application::use_cases::seed_labels::seed_starter_labels;
use cashmemo_appwrite_adapter::{
    AppwriteClient, AppwriteSessionValidator, JournalGenerations, JournalStateStore, LabelStore,
};
use cashmemo_domain::label::{LabelKind, normalized_name};
use cashmemo_domain::{ErrorCode, Label, LabelId, Timestamp};

use support::TestEnvironment;

#[tokio::test]
async fn real_session_read_list_and_mutation_matrix_is_owner_isolated() -> Result<(), String> {
    let environment = TestEnvironment::from_environment()?;
    let user_a = environment.create_user_session().await?;
    let user_b = environment.create_user_session().await?;
    let client = AppwriteClient::new(environment.config.clone())?;
    let validator = AppwriteSessionValidator::new(client.clone());
    let owner_a = validator
        .validate(&user_a.secret)
        .await
        .map_err(|_| "user A session rejected")?;
    let owner_b = validator
        .validate(&user_b.secret)
        .await
        .map_err(|_| "user B session rejected")?;
    assert_eq!(owner_a.id().as_str(), user_a.user_id);
    assert_eq!(owner_b.id().as_str(), user_b.user_id);

    verify_journal_transaction(&client, &owner_a).await?;

    let store = LabelStore::new(client);
    let seeded_once = seed_starter_labels(
        &store,
        &owner_a,
        Timestamp::from_micros(1_767_225_600_000_000),
    )
    .await
    .map_err(|_| "starter seeding failed")?;
    let seeded_twice = seed_starter_labels(
        &store,
        &owner_a,
        Timestamp::from_micros(1_767_225_600_000_001),
    )
    .await
    .map_err(|_| "starter reseeding failed")?;
    assert_eq!(
        seeded_once.iter().map(|label| label.id).collect::<Vec<_>>(),
        seeded_twice
            .iter()
            .map(|label| label.id)
            .collect::<Vec<_>>()
    );
    let label = Label::new(
        LabelId::random(),
        owner_a.id().clone(),
        LabelKind::Category,
        "Owner A Only",
        Timestamp::from_micros(1_767_225_600_000_000),
    )
    .map_err(|_| "label fixture rejected")?;
    let persisted = store
        .create_if_absent(&owner_a, &label)
        .await
        .map_err(|_| "label seed failed")?;

    assert!(
        store
            .get(&owner_a, persisted.id)
            .await
            .map_err(|_| "same-owner read failed")?
            .is_some()
    );
    assert!(
        store
            .get(&owner_b, persisted.id)
            .await
            .map_err(|_| "cross-owner read did not map safely")?
            .is_none()
    );
    assert!(
        store
            .list(&owner_b)
            .await
            .map_err(|_| "cross-owner list failed")?
            .iter()
            .all(|item| item.id != persisted.id)
    );

    let denied = store
        .rename_raw(
            &owner_b,
            persisted.id,
            "Forbidden Rename",
            &normalized_name("Forbidden Rename"),
        )
        .await;
    assert!(denied.is_err_and(|error| error.code == ErrorCode::NotFound));
    store
        .rename_raw(
            &owner_a,
            persisted.id,
            "Owner A Renamed",
            &normalized_name("Owner A Renamed"),
        )
        .await
        .map_err(|_| "same-owner mutation failed")?;

    environment.revoke_session(&user_a).await?;
    assert!(
        validator
            .validate(&user_a.secret)
            .await
            .is_err_and(|error| error.code == ErrorCode::AuthRequired)
    );
    environment.delete_user(&user_a.user_id).await?;
    environment.delete_user(&user_b.user_id).await?;
    Ok(())
}

async fn verify_journal_transaction(
    client: &AppwriteClient,
    owner: &AuthenticatedOwner,
) -> Result<(), String> {
    let journal = JournalStateStore::new(client.clone());
    let transaction_id = client
        .create_transaction(60)
        .await
        .map_err(|_| "journal transaction unavailable")?;
    let expected = JournalGenerations {
        mutation: 1,
        base_result: 1,
        note_search: 0,
        memo_type: 1,
        currency: 1,
        category: 1,
        money_space: 1,
        planned_status: 1,
        purpose: 1,
    };
    journal
        .stage_generations(owner, &transaction_id, expected)
        .await
        .map_err(|_| "journal generation stage failed")?;
    client
        .commit_transaction(&transaction_id)
        .await
        .map_err(|_| "journal generation commit failed")?;
    assert_eq!(
        journal
            .generations(owner)
            .await
            .map_err(|_| "journal generation read failed")?,
        expected
    );
    Ok(())
}
