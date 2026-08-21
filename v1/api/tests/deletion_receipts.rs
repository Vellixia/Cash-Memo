use cashmemo_api::receipts::{DeletionReceipt, canonical_receipt_bytes, receipt_object_key};
use chrono::{TimeZone, Utc};

#[cfg(feature = "s3-receipts")]
mod s3 {
    use std::env;

    use aws_config::BehaviorVersion;
    use aws_credential_types::{Credentials, provider::SharedCredentialsProvider};
    use aws_sdk_s3::{Client, config::Region, primitives::ByteStream};
    use cashmemo_api::receipts::{
        DeletionReceipt, DeletionReceiptStore, ReceiptError, ReceiptWrite, canonical_receipt_bytes,
        receipt_object_key,
        s3::{S3DeletionReceiptStore, S3ReceiptConfig},
    };
    use chrono::{TimeZone, Utc};

    fn config() -> S3ReceiptConfig {
        S3ReceiptConfig {
            endpoint: env::var("TEST_DELETION_RECEIPT_S3_ENDPOINT")
                .expect("disposable MinIO endpoint"),
            region: "us-east-1".into(),
            bucket: env::var("TEST_DELETION_RECEIPT_S3_BUCKET").expect("disposable bucket"),
            prefix: "receipts".into(),
            access_key_id: env::var("TEST_DELETION_RECEIPT_S3_ACCESS_KEY_ID")
                .expect("disposable key"),
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

    #[tokio::test]
    async fn concrete_s3_store_is_idempotent_and_fails_closed_on_divergence() {
        let config = config();
        let client = client(&config).await;
        let _ = client.create_bucket().bucket(&config.bucket).send().await;
        let store = S3DeletionReceiptStore::connect(config.clone())
            .await
            .unwrap();
        let mut hmac_user_id = [0_u8; 32];
        let nonce = uuid::Uuid::new_v4().into_bytes();
        hmac_user_id[..16].copy_from_slice(&nonce);
        hmac_user_id[16..].copy_from_slice(&nonce);
        let receipt = DeletionReceipt::new(
            hmac_user_id,
            Utc.with_ymd_and_hms(2026, 8, 21, 12, 0, 0).unwrap(),
            9,
        );
        let key = receipt_object_key(&config.prefix, &receipt);

        assert_eq!(
            store.put_receipt(&receipt).await.unwrap(),
            ReceiptWrite::Created
        );
        let body = client
            .get_object()
            .bucket(&config.bucket)
            .key(&key)
            .send()
            .await
            .unwrap()
            .body
            .collect()
            .await
            .unwrap()
            .into_bytes()
            .to_vec();
        assert_eq!(body, canonical_receipt_bytes(&receipt).unwrap());
        assert_eq!(
            store.put_receipt(&receipt).await.unwrap(),
            ReceiptWrite::AlreadyPresentIdentical
        );

        client
            .put_object()
            .bucket(&config.bucket)
            .key(&key)
            .body(ByteStream::from_static(b"conflict"))
            .send()
            .await
            .unwrap();
        assert_eq!(
            store.put_receipt(&receipt).await,
            Err(ReceiptError::DivergentObject)
        );
    }

    #[test]
    fn receipt_endpoint_rejects_remote_http_and_accepts_only_explicit_local_http() {
        let mut config = S3ReceiptConfig {
            endpoint: "http://storage.example.test".into(),
            region: "us-east-1".into(),
            bucket: "receipts".into(),
            prefix: "receipts".into(),
            access_key_id: "test".into(),
            secret_access_key: "test".into(),
            allow_insecure_local_endpoint: true,
        };
        assert!(config.validate_endpoint().is_err());
        config.endpoint = "http://127.0.0.1:9000".into();
        assert!(config.validate_endpoint().is_ok());
        config.allow_insecure_local_endpoint = false;
        assert!(config.validate_endpoint().is_err());
        config.endpoint = "https://storage.example.test".into();
        assert!(config.validate_endpoint().is_ok());
    }
}

#[test]
fn receipt_key_and_canonical_payload_are_stable_across_retries() {
    let receipt = DeletionReceipt::new(
        [0xab; 32],
        Utc.with_ymd_and_hms(2026, 8, 21, 12, 0, 0).unwrap(),
        7,
    );

    assert_eq!(
        receipt_object_key("anti-resurrection/", &receipt),
        "anti-resurrection/v7/abababababababababababababababababababababababababababababababab.json"
    );
    assert_eq!(
        canonical_receipt_bytes(&receipt).unwrap(),
        br#"{"hmac_user_id":"abababababababababababababababababababababababababababababababab","purged_at":"2026-08-21T12:00:00Z","key_version":7}"#
    );
}
