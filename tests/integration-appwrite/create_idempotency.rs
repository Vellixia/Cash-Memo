//! Real supported-API creation idempotency, race, and owner-isolation proof.

mod support;

use std::sync::Arc;

use cashmemo_application::authorization::{AuthenticatedOwner, SessionValidator};
use cashmemo_application::clock::ManualClock;
use cashmemo_application::keyring::{KekKeyring, RuntimeKek};
use cashmemo_application::ports::LabelRepository;
use cashmemo_application::use_cases::create_money_memo::CreateMoneyMemoService;
use cashmemo_application::use_cases::seed_labels::seed_starter_labels;
use cashmemo_appwrite_adapter::{
    AppwriteClient, AppwriteSessionValidator, CreateMoneyMemoStore, JournalStateStore, LabelStore,
};
use cashmemo_domain::create::CreateCandidate;
use cashmemo_domain::money_memo::{MoneyMemoType, PlannedStatus, Purpose};
use cashmemo_domain::{ErrorCode, LabelId, Timestamp};

use support::TestEnvironment;

fn candidate(creation_id: String, category_id: String, space_id: String) -> CreateCandidate {
    CreateCandidate {
        creation_id,
        memo_type: Some(MoneyMemoType::Expense),
        amount: "42.50".to_owned(),
        currency: "USD".to_owned(),
        occurrence_instant: "2026-07-30T12:15:00.000000Z".to_owned(),
        occurrence_local_wall: "2026-07-30T19:15:00.000000".to_owned(),
        occurrence_offset: "+07:00".to_owned(),
        category_id,
        money_space_id: space_id,
        note: Some("Lunch".to_owned()),
        planned_status: Some(PlannedStatus::Unplanned),
        purpose: Some(Purpose::Personal),
    }
}

#[tokio::test]
async fn same_creation_is_exactly_once_and_different_creation_is_distinct() -> Result<(), String> {
    let environment = TestEnvironment::from_environment()?;
    let user = environment.create_user_session().await?;
    let client = AppwriteClient::new(environment.config.clone())?;
    let owner = AppwriteSessionValidator::new(client.clone())
        .validate(&user.secret)
        .await
        .map_err(|_| "session rejected")?;
    let labels = seed_starter_labels(
        &LabelStore::new(client.clone()),
        &owner,
        Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z").map_err(|_| "clock")?,
    )
    .await
    .map_err(|_| "labels unavailable")?;
    let category = labels
        .iter()
        .find(|label| matches!(label.kind, cashmemo_domain::label::LabelKind::Category))
        .ok_or("category unavailable")?;
    let space = labels
        .iter()
        .find(|label| matches!(label.kind, cashmemo_domain::label::LabelKind::MoneySpace))
        .ok_or("space unavailable")?;
    let ring = KekKeyring::new(
        "kek-test-a",
        vec![RuntimeKek::new("kek-test-a", [0x31; 32]).map_err(|_| "key")?],
    )
    .map_err(|_| "keyring")?;
    let service = Arc::new(CreateMoneyMemoService::new(
        Arc::new(CreateMoneyMemoStore::new(client.clone())),
        Arc::new(ring),
        Arc::new(ManualClock::new(
            Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z").map_err(|_| "clock")?,
        )),
    ));
    let creation_id = uuid::Uuid::new_v4().hyphenated().to_string();
    let request = candidate(creation_id, category.id.to_string(), space.id.to_string());
    let mut joins = Vec::new();
    for _ in 0..32 {
        let service = Arc::clone(&service);
        let owner = owner.clone();
        let request = request.clone();
        joins.push(tokio::spawn(async move {
            service.execute(&owner, request).await
        }));
    }
    let mut results = Vec::new();
    for join in joins {
        results.push(
            join.await
                .map_err(|_| "join failed")?
                .map_err(|_| "concurrent create failed")?,
        );
    }
    assert_eq!(results.iter().filter(|result| result.created).count(), 1);
    let first = results.first().ok_or("no create result")?;
    assert!(results.iter().all(|result| result.memo.id == first.memo.id));
    let retry = service
        .execute(&owner, request.clone())
        .await
        .map_err(|_| "retry failed")?;
    assert!(!retry.created);
    assert_eq!(retry.memo.revision, first.memo.revision);
    assert_eq!(retry.memo.lifecycle.status, first.memo.lifecycle.status);

    assert_fingerprint_is_opaque(&client, &owner, &request.creation_id).await?;

    let mut changed = request.clone();
    changed.amount = "43.00".to_owned();
    let conflict = service.execute(&owner, changed).await;
    assert!(conflict.is_err_and(|error| error.code == ErrorCode::CreationIdentifierConflict));

    let distinct = service
        .execute(
            &owner,
            candidate(
                uuid::Uuid::new_v4().hyphenated().to_string(),
                category.id.to_string(),
                space.id.to_string(),
            ),
        )
        .await
        .map_err(|_| "distinct create failed")?;
    assert_ne!(distinct.memo.id, first.memo.id);
    assert_account_state(&client, &owner, category.id, space.id, 2).await?;

    environment.delete_user(&user.user_id).await?;
    Ok(())
}

async fn assert_account_state(
    client: &AppwriteClient,
    owner: &AuthenticatedOwner,
    category_id: LabelId,
    space_id: LabelId,
    expected: u64,
) -> Result<(), String> {
    let labels = LabelStore::new(client.clone());
    let category = labels
        .get(owner, category_id)
        .await
        .map_err(|_| "category count unavailable")?
        .ok_or("category absent")?;
    let space = labels
        .get(owner, space_id)
        .await
        .map_err(|_| "space count unavailable")?
        .ok_or("space absent")?;
    assert_eq!(category.memo_reference_count, expected);
    assert_eq!(space.memo_reference_count, expected);
    let generations = JournalStateStore::new(client.clone())
        .generations(owner)
        .await
        .map_err(|_| "journal unavailable")?;
    assert_eq!(
        generations.mutation,
        i64::try_from(expected).map_err(|_| "count")?
    );
    assert_eq!(
        generations.base_result,
        i64::try_from(expected).map_err(|_| "count")?
    );
    Ok(())
}

async fn assert_fingerprint_is_opaque(
    client: &AppwriteClient,
    owner: &AuthenticatedOwner,
    creation_id: &str,
) -> Result<(), String> {
    let scope = cashmemo_appwrite_adapter::query::OwnerScope::new(owner);
    let mut queries = scope.memo_list();
    queries.push(
        scope
            .extra_equal("creation_id", creation_id)
            .map_err(|_| "query unavailable")?,
    );
    let rows = client
        .list_rows("money_memos", &queries, None)
        .await
        .map_err(|_| "memo proof unavailable")?;
    let row = rows.first().ok_or("memo proof absent")?;
    let fingerprint = row
        .get("creation_fingerprint")
        .and_then(serde_json::Value::as_str)
        .ok_or("fingerprint absent")?;
    assert_eq!(fingerprint.len(), 64);
    assert!(fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit()));
    for internal in [
        "fingerprint_key_ciphertext",
        "fingerprint_key_nonce",
        "fingerprint_kek_id",
    ] {
        assert!(
            row.get(internal)
                .and_then(serde_json::Value::as_str)
                .is_some()
        );
    }
    for forbidden in ["42.50", "Lunch", "USD", "2026-07-30"] {
        assert!(!fingerprint.contains(forbidden));
    }
    Ok(())
}

#[tokio::test]
async fn identical_creation_identifier_is_unique_per_owner() -> Result<(), String> {
    let environment = TestEnvironment::from_environment()?;
    let user_a = environment.create_user_session().await?;
    let user_b = environment.create_user_session().await?;
    let client = AppwriteClient::new(environment.config.clone())?;
    let validator = AppwriteSessionValidator::new(client.clone());
    let owner_a = validator
        .validate(&user_a.secret)
        .await
        .map_err(|_| "session A rejected")?;
    let owner_b = validator
        .validate(&user_b.secret)
        .await
        .map_err(|_| "session B rejected")?;
    let clock = Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z").map_err(|_| "clock")?;
    let labels_a = seed_starter_labels(&LabelStore::new(client.clone()), &owner_a, clock)
        .await
        .map_err(|_| "labels A unavailable")?;
    let labels_b = seed_starter_labels(&LabelStore::new(client.clone()), &owner_b, clock)
        .await
        .map_err(|_| "labels B unavailable")?;
    let ids = |labels: &[cashmemo_domain::Label]| -> Result<(String, String), String> {
        let category = labels
            .iter()
            .find(|label| matches!(label.kind, cashmemo_domain::label::LabelKind::Category))
            .ok_or_else(|| "category unavailable".to_owned())?;
        let space = labels
            .iter()
            .find(|label| matches!(label.kind, cashmemo_domain::label::LabelKind::MoneySpace))
            .ok_or_else(|| "space unavailable".to_owned())?;
        Ok((category.id.to_string(), space.id.to_string()))
    };
    let (category_a, space_a) = ids(&labels_a)?;
    let (category_b, space_b) = ids(&labels_b)?;
    let service = CreateMoneyMemoService::new(
        Arc::new(CreateMoneyMemoStore::new(client)),
        Arc::new(
            KekKeyring::new(
                "kek-test-a",
                vec![RuntimeKek::new("kek-test-a", [0x31; 32]).map_err(|_| "key")?],
            )
            .map_err(|_| "keyring")?,
        ),
        Arc::new(ManualClock::new(clock)),
    );
    let creation_id = uuid::Uuid::new_v4().hyphenated().to_string();
    let memo_a = service
        .execute(
            &owner_a,
            candidate(creation_id.clone(), category_a, space_a),
        )
        .await
        .map_err(|_| "owner A create failed")?;
    let memo_b = service
        .execute(&owner_b, candidate(creation_id, category_b, space_b))
        .await
        .map_err(|_| "owner B create failed")?;
    assert_ne!(memo_a.memo.id, memo_b.memo.id);
    environment.delete_user(&user_a.user_id).await?;
    environment.delete_user(&user_b.user_id).await?;
    Ok(())
}
