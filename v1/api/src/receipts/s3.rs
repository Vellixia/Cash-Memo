use aws_config::BehaviorVersion;
use aws_credential_types::{Credentials, provider::SharedCredentialsProvider};
use aws_sdk_s3::{Client, config::Region, primitives::ByteStream};

use super::{DeletionReceipt, DeletionReceiptStore, ReceiptError, ReceiptWrite, canonical_receipt_bytes, receipt_object_key};

#[derive(Clone, Debug)]
pub struct S3ReceiptConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub prefix: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Clone)]
pub struct S3DeletionReceiptStore { client: Client, bucket: String, prefix: String }

impl S3DeletionReceiptStore {
    pub async fn connect(config: S3ReceiptConfig) -> Result<Self, ReceiptError> {
        if [config.endpoint.as_str(), config.region.as_str(), config.bucket.as_str(), config.access_key_id.as_str(), config.secret_access_key.as_str()].iter().any(|value| value.trim().is_empty()) { return Err(ReceiptError::Configuration); }
        let credentials = Credentials::new(config.access_key_id, config.secret_access_key, None, None, "deletion-receipts");
        let sdk_config = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(config.region))
            .credentials_provider(SharedCredentialsProvider::new(credentials))
            .endpoint_url(config.endpoint)
            .load().await;
        Ok(Self { client: Client::new(&sdk_config), bucket: config.bucket, prefix: config.prefix })
    }

    async fn existing(&self, key: &str) -> Result<Option<Vec<u8>>, ReceiptError> {
        match self.client.get_object().bucket(&self.bucket).key(key).send().await {
            Ok(output) => output.body.collect().await.map(|body| Some(body.into_bytes().to_vec())).map_err(|_| ReceiptError::Storage),
            Err(error) if error.as_service_error().is_some_and(|service| service.is_no_such_key()) => Ok(None),
            Err(_) => Err(ReceiptError::Storage),
        }
    }
}

#[async_trait::async_trait]
impl DeletionReceiptStore for S3DeletionReceiptStore {
    async fn put_receipt(&self, receipt: &DeletionReceipt) -> Result<ReceiptWrite, ReceiptError> {
        let key = receipt_object_key(&self.prefix, receipt);
        let expected = canonical_receipt_bytes(receipt).map_err(|_| ReceiptError::Storage)?;
        if let Some(existing) = self.existing(&key).await? { return if existing == expected { Ok(ReceiptWrite::AlreadyPresentIdentical) } else { Err(ReceiptError::DivergentObject) }; }
        self.client.put_object().bucket(&self.bucket).key(&key).body(ByteStream::from(expected.clone())).send().await.map_err(|_| ReceiptError::Storage)?;
        match self.existing(&key).await? {
            Some(actual) if actual == expected => Ok(ReceiptWrite::Created),
            Some(_) => Err(ReceiptError::DivergentObject),
            None => Err(ReceiptError::Storage),
        }
    }
}
