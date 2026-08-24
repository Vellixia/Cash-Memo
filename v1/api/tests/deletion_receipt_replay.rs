#![cfg(feature = "s3-receipts")]

use std::{env, sync::Arc};

use aws_config::BehaviorVersion;
use aws_credential_types::{Credentials, provider::SharedCredentialsProvider};
use aws_sdk_s3::{Client, config::Region, primitives::ByteStream};
use cashmemo_api::{
    auth::{AuthConfig, AuthService, UnconfiguredEmailSender},
    receipts::{
        DeletionReceipt, DeletionReceiptStore, canonical_receipt_bytes, hmac_user_id,
        receipt_object_key,
        replay::replay_deletion_receipts,
        s3::{S3DeletionReceiptStore, S3ReceiptConfig},
    },
};
use chrono::{TimeZone, Utc};
use sqlx::PgPool;

fn receipt_config() -> S3ReceiptConfig {
    S3ReceiptConfig {
        endpoint: env::var("TEST_DELETION_RECEIPT_S3_ENDPOINT").expect("disposable MinIO endpoint"),
        region: "us-east-1".into(),
        bucket: env::var("TEST_DELETION_RECEIPT_S3_BUCKET").expect("disposable bucket"),
        prefix: format!("restore-replay/{}", uuid::Uuid::new_v4()),
        access_key_id: env::var("TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID").expect("disposable key"),
        secret_access_key: env::var("TEST_DELETION_RECEIPT_S3_SECRET_ACCESS_KEY")
            .expect("disposable secret"),
        allow_insecure_local_endpoint: true,
    }
}

async fn client(config: &S3ReceiptConfig) -> Client {
    let credentials = Credentials::new(
        config.access_key_id.clone(),
        config.secret_access_key.clone(),
        None,
        None,
        "test",
    );
    let sdk = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(config.region.clone()))
        .credentials_provider(SharedCredentialsProvider::new(credentials))
        .endpoint_url(config.endpoint.clone())
        .load()
        .await;
    Client::new(&sdk)
}

async fn restored_user(pool: PgPool, suffix: &str) -> uuid::Uuid {
    let auth = AuthService::new(
        pool.clone(),
        Arc::new(UnconfiguredEmailSender),
        AuthConfig::for_tests(),
    );
    auth.register(
        &format!("restore-{suffix}@example.test"),
        "correct horse battery staple",
    )
    .await
    .unwrap();
    sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(format!("restore-{suffix}@example.test"))
        .fetch_one(&pool)
        .await
        .unwrap()
}

#[sqlx::test(migrations = "./migrations")]
async fn isolated_restored_postgres_replay_purges_matches_across_key_versions_and_is_idempotent(
    pool: PgPool,
) {
    let config = receipt_config();
    let client = client(&config).await;
    let _ = client.create_bucket().bucket(&config.bucket).send().await;
    let store = S3DeletionReceiptStore::connect(config.clone())
        .await
        .unwrap();
    let first = restored_user(pool.clone(), "first").await;
    let second = restored_user(pool.clone(), "second").await;
    let receipt_one = DeletionReceipt::new(
        hmac_user_id(&[1; 32], first).unwrap(),
        Utc.with_ymd_and_hms(2026, 8, 21, 12, 0, 0).unwrap(),
        1,
    );
    let receipt_two = DeletionReceipt::new(
        hmac_user_id(&[2; 32], second).unwrap(),
        Utc.with_ymd_and_hms(2026, 8, 21, 12, 1, 0).unwrap(),
        2,
    );
    store.put_receipt(&receipt_one).await.unwrap();
    store.put_receipt(&receipt_two).await.unwrap();

    let summary = replay_deletion_receipts(&pool, &store, &[(1, vec![1; 32]), (2, vec![2; 32])])
        .await
        .unwrap();
    assert_eq!(summary.receipts_scanned, 2);
    assert_eq!(summary.users_purged, 2);
    assert_eq!(summary.unreadable_receipts, 0);
    assert_eq!(summary.unprocessed_matches, 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );

    let repeated = replay_deletion_receipts(&pool, &store, &[(1, vec![1; 32]), (2, vec![2; 32])])
        .await
        .unwrap();
    assert_eq!(repeated.users_purged, 0);
    assert_eq!(repeated.unreadable_receipts, 0);
    assert_eq!(repeated.unprocessed_matches, 0);
}

#[sqlx::test(migrations = "./migrations")]
async fn malformed_or_divergent_receipt_fails_closed_without_purging_restored_user(pool: PgPool) {
    let config = receipt_config();
    let client = client(&config).await;
    let _ = client.create_bucket().bucket(&config.bucket).send().await;
    let store = S3DeletionReceiptStore::connect(config.clone())
        .await
        .unwrap();
    let user = restored_user(pool.clone(), "malformed").await;
    let receipt = DeletionReceipt::new(
        hmac_user_id(&[3; 32], user).unwrap(),
        Utc.with_ymd_and_hms(2026, 8, 21, 12, 2, 0).unwrap(),
        3,
    );
    let key = receipt_object_key(&config.prefix, &receipt);
    client
        .put_object()
        .bucket(&config.bucket)
        .key(key)
        .body(ByteStream::from_static(b"{\"key_version\":3}"))
        .send()
        .await
        .unwrap();

    let summary = replay_deletion_receipts(&pool, &store, &[(3, vec![3; 32])])
        .await
        .unwrap();
    assert_eq!(summary.unreadable_receipts, 1);
    assert_eq!(summary.users_purged, 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM users")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert!(!canonical_receipt_bytes(&receipt).unwrap().is_empty());
}
