//! Private object storage (Cloudflare R2 in production, MinIO locally) for CSV exports and
//! uploads. Only presigned URLs are produced here; whoever holds a URL does the HTTP itself,
//! so file bytes never pass through the API.
use std::time::Duration;

use rusty_s3::{
    Bucket, Credentials, S3Action, UrlStyle,
    actions::{DeleteObject, GetObject, HeadObject, ListObjectsV2, PutObject},
};

pub struct Storage {
    bucket: Bucket,
    creds: Credentials,
}

impl Storage {
    /// None unless S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are all set.
    pub fn from_env() -> Option<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let endpoint = var("S3_ENDPOINT")?.parse().ok()?;
        let region = var("S3_REGION").unwrap_or_else(|| "auto".into());
        let bucket = Bucket::new(endpoint, UrlStyle::Path, var("S3_BUCKET")?, region).ok()?;
        let creds = Credentials::new(var("S3_ACCESS_KEY_ID")?, var("S3_SECRET_ACCESS_KEY")?);
        Some(Storage { bucket, creds })
    }

    /// Download link that saves as `filename`.
    pub fn get_url(&self, key: &str, filename: &str, ttl: Duration) -> String {
        let mut a = GetObject::new(&self.bucket, Some(&self.creds), key);
        let disposition = format!("attachment; filename=\"{filename}\"");
        a.query_mut()
            .insert("response-content-disposition", disposition);
        a.sign(ttl).to_string()
    }

    pub fn put_url(&self, key: &str, ttl: Duration) -> String {
        PutObject::new(&self.bucket, Some(&self.creds), key)
            .sign(ttl)
            .to_string()
    }

    /// Like `put_url`, but signs `content-type` too: R2/S3 then rejects a PUT whose header
    /// doesn't match exactly, so an attachment upload can only ever land as the type we chose.
    pub fn put_url_typed(&self, key: &str, content_type: &str, ttl: Duration) -> String {
        let mut a = PutObject::new(&self.bucket, Some(&self.creds), key);
        a.headers_mut().insert("content-type", content_type);
        a.sign(ttl).to_string()
    }

    /// Rendered inline (no `Content-Disposition`), unlike `get_url`'s forced download — for
    /// viewing an attachment image directly.
    pub fn get_inline_url(&self, key: &str, ttl: Duration) -> String {
        GetObject::new(&self.bucket, Some(&self.creds), key)
            .sign(ttl)
            .to_string()
    }

    /// Presigned HEAD, so the API can confirm an upload landed (and check its size) without
    /// the object's bytes ever passing through it.
    pub fn head_url(&self, key: &str, ttl: Duration) -> String {
        HeadObject::new(&self.bucket, Some(&self.creds), key)
            .sign(ttl)
            .to_string()
    }

    pub fn delete_url(&self, key: &str, ttl: Duration) -> String {
        DeleteObject::new(&self.bucket, Some(&self.creds), key)
            .sign(ttl)
            .to_string()
    }

    pub fn list_url(&self, prefix: &str, ttl: Duration) -> String {
        let mut a = ListObjectsV2::new(&self.bucket, Some(&self.creds));
        a.with_prefix(prefix);
        a.sign(ttl).to_string()
    }

    /// Keys from a ListObjectsV2 XML response.
    pub fn parse_list(xml: &str) -> Vec<String> {
        ListObjectsV2::parse_response(xml)
            .map(|r| r.contents.into_iter().map(|c| c.key).collect())
            .unwrap_or_default()
    }
}

/// Everything a user owns lives under this prefix, so deleting an account can sweep it.
/// **Scope stays `users/`**: the production bucket's 1-day lifecycle rule (for CSV exports and
/// import uploads) is keyed off this prefix and must never be widened to the whole bucket.
pub fn user_prefix(user_id: uuid::Uuid) -> String {
    format!("users/{user_id}/")
}

/// Receipt/photo attachments live outside `users/` on purpose, so the CSV lifecycle rule above
/// can never expire them. Deleting an account sweeps this prefix too (see apps/api account.rs).
pub fn attachment_prefix(user_id: uuid::Uuid) -> String {
    format!("attachments/{user_id}/")
}
