//! Real Appwrite unknown/other-owner indistinguishability and coarse timing envelope.

use std::env;
use std::time::{Duration, Instant};

use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_appwrite_adapter::{AppwriteClient, AppwriteConfig, MoneyMemoStore};
use cashmemo_domain::{MoneyMemoId, OwnerId};
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::json;
use uuid::Uuid;

fn configuration() -> Result<(AppwriteConfig, String), String> {
    let endpoint =
        env::var("APPWRITE_ENDPOINT").map_err(|_| "APPWRITE_ENDPOINT required for real test")?;
    let project_id = env::var("APPWRITE_PROJECT_ID")
        .map_err(|_| "APPWRITE_PROJECT_ID required for real test")?;
    let api_key = env::var("APPWRITE_SERVER_API_KEY")
        .map_err(|_| "APPWRITE_SERVER_API_KEY required for real test")?;
    let database_id = env::var("APPWRITE_DATABASE_ID").unwrap_or_else(|_| "cashmemo".to_owned());
    Ok((
        AppwriteConfig {
            endpoint,
            project_id,
            api_key,
            database_id,
        },
        "money_memos".to_owned(),
    ))
}

async fn seed_row(
    config: &AppwriteConfig,
    memo_id: MoneyMemoId,
    owner: &OwnerId,
) -> Result<(), String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "X-Appwrite-Project",
        HeaderValue::from_str(&config.project_id).map_err(|_| "project header invalid")?,
    );
    headers.insert(
        "X-Appwrite-Key",
        HeaderValue::from_str(&config.api_key).map_err(|_| "key header invalid")?,
    );
    let response = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|_| "seed client unavailable")?
        .post(format!("{}/tablesdb/{}/tables/money_memos/rows", config.endpoint.trim_end_matches('/'), config.database_id))
        .json(&json!({
            "rowId": memo_id.to_string(),
            "data": {
                "memo_id": memo_id.to_string(), "owner_id": owner.as_str(), "memo_type": "expense",
                "amount_minor": 100, "amount_scale": 2, "currency": "USD",
                "occurrence_instant_us": 1_767_225_600_000_000_i64,
                "occurrence_local_wall": "2026-01-01T00:00:00.000000", "occurrence_local_date": "2026-01-01",
                "occurrence_offset_minutes": 0, "category_id": Uuid::new_v4().to_string(),
                "money_space_id": Uuid::new_v4().to_string(), "planned_status": "unplanned", "purpose": "personal",
                "lifecycle_status": "active", "revision": 1, "creation_id": Uuid::new_v4().to_string(),
                "creation_fingerprint": "00", "fingerprint_key_ciphertext": "00", "fingerprint_key_nonce": "00",
                "fingerprint_kek_id": "k1", "created_at_us": 1_767_225_600_000_000_i64,
                "updated_at_us": 1_767_225_600_000_000_i64
            }
        }))
        .send()
        .await
        .map_err(|_| "seed request failed")?;
    if !response.status().is_success() {
        return Err(format!(
            "seed failed with HTTP {}",
            response.status().as_u16()
        ));
    }
    Ok(())
}

async fn delete_row(config: &AppwriteConfig, memo_id: MoneyMemoId) -> Result<(), String> {
    let response = reqwest::Client::new()
        .delete(format!(
            "{}/tablesdb/{}/tables/money_memos/rows/{memo_id}",
            config.endpoint.trim_end_matches('/'),
            config.database_id
        ))
        .header("X-Appwrite-Project", &config.project_id)
        .header("X-Appwrite-Key", &config.api_key)
        .send()
        .await
        .map_err(|_| "cleanup request failed")?;
    if !response.status().is_success() {
        return Err(format!(
            "cleanup failed with HTTP {}",
            response.status().as_u16()
        ));
    }
    Ok(())
}

#[tokio::test]
async fn unknown_and_other_owner_are_both_absent_within_same_timing_envelope() -> Result<(), String>
{
    let (config, _) = configuration()?;
    let memo_id = MoneyMemoId::new(Uuid::new_v4());
    let owner_a = OwnerId::parse_authenticated_account(&format!("u{}", Uuid::new_v4().simple()))
        .map_err(|_| "owner fixture invalid")?;
    let owner_b = AuthenticatedOwner::after_account_validation(
        OwnerId::parse_authenticated_account(&format!("u{}", Uuid::new_v4().simple()))
            .map_err(|_| "owner fixture invalid")?,
    );
    seed_row(&config, memo_id, &owner_a).await?;

    let store = MoneyMemoStore::new(AppwriteClient::new(config.clone())?);
    let mut other_elapsed = Duration::ZERO;
    let mut unknown_elapsed = Duration::ZERO;
    for _ in 0..12 {
        let started = Instant::now();
        assert!(store.find_raw(&owner_b, memo_id).await?.is_none());
        other_elapsed += started.elapsed();

        let started = Instant::now();
        assert!(
            store
                .find_raw(&owner_b, MoneyMemoId::new(Uuid::new_v4()))
                .await?
                .is_none()
        );
        unknown_elapsed += started.elapsed();
    }
    delete_row(&config, memo_id).await?;

    assert!(other_elapsed.abs_diff(unknown_elapsed) < Duration::from_secs(2));
    Ok(())
}
