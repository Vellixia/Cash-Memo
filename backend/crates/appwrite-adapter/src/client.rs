//! Redacted Appwrite REST/GraphQL client with ambiguity-safe request behavior.

use std::fmt;
use std::time::Duration;

use reqwest::{Method, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

/// Runtime Appwrite connection configuration.
#[derive(Clone)]
pub struct AppwriteConfig {
    /// Supported API base ending in `/v1`.
    pub endpoint: String,
    /// Appwrite project ID.
    pub project_id: String,
    /// Backend-only scoped API key.
    pub api_key: String,
    /// `TablesDB` database ID.
    pub database_id: String,
}

impl fmt::Debug for AppwriteConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AppwriteConfig")
            .field("endpoint", &"[CONFIGURED]")
            .field("project_id", &"[REDACTED]")
            .field("api_key", &"[REDACTED]")
            .field("database_id", &"[REDACTED]")
            .finish()
    }
}

/// Safe failure classification. Appwrite response bodies are never retained.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppwriteError {
    /// Session absent, invalid, expired, or revoked.
    Unauthorized,
    /// Resource not found.
    NotFound,
    /// Concurrent or uniqueness conflict.
    Conflict,
    /// Supported API rejected adapter input/capability.
    InvalidRequest,
    /// Network, timeout, server, or decoding failure.
    Unavailable,
}

/// Shared supported-API client.
#[derive(Clone)]
pub struct AppwriteClient {
    client: reqwest::Client,
    config: AppwriteConfig,
}

impl fmt::Debug for AppwriteClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AppwriteClient([REDACTED CONFIG])")
    }
}

#[derive(Deserialize)]
struct GraphQlEnvelope {
    data: Option<Value>,
    errors: Option<Vec<Value>>,
}

impl AppwriteClient {
    /// Builds a client without exposing configuration in error strings.
    pub fn new(mut config: AppwriteConfig) -> Result<Self, String> {
        config.endpoint = config.endpoint.trim_end_matches('/').to_owned();
        if config.endpoint.is_empty()
            || config.project_id.is_empty()
            || config.api_key.is_empty()
            || config.database_id.is_empty()
        {
            return Err("required Appwrite runtime configuration missing".to_owned());
        }
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| "Appwrite client unavailable".to_owned())?;
        Ok(Self { client, config })
    }

    /// Database ID for checked-in `TablesDB` resources.
    #[must_use]
    pub fn database_id(&self) -> &str {
        &self.config.database_id
    }

    /// Validates an opaque SSR session through the supported Account API.
    pub async fn account_id(&self, session: &str) -> Result<String, AppwriteError> {
        if session.is_empty() || session.len() > 4096 {
            return Err(AppwriteError::Unauthorized);
        }
        let response = self
            .client
            .get(format!("{}/account", self.config.endpoint))
            .header("X-Appwrite-Project", &self.config.project_id)
            .header("X-Appwrite-Session", session)
            .header("Cache-Control", "no-store")
            .send()
            .await
            .map_err(|_| AppwriteError::Unavailable)?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(AppwriteError::Unauthorized);
        }
        if !response.status().is_success() {
            return Err(classify(response.status()));
        }
        let value = response
            .json::<Value>()
            .await
            .map_err(|_| AppwriteError::Unavailable)?;
        value
            .get("$id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(AppwriteError::Unavailable)
    }

    /// Executes a `TablesDB` GraphQL list with body-only variables and `ttl=0`.
    pub async fn list_rows(
        &self,
        table: &str,
        queries: &[String],
        transaction_id: Option<&str>,
    ) -> Result<Vec<Value>, AppwriteError> {
        let payload = json!({
            "query": "query Rows($databaseId: String!, $tableId: String!, $queries: [String!], $transactionId: String, $ttl: Int!, $total: Boolean!) { tablesDBListRows(databaseId: $databaseId, tableId: $tableId, queries: $queries, transactionId: $transactionId, ttl: $ttl, total: $total) { rows { data } } }",
            "variables": {
                "databaseId": self.config.database_id,
                "tableId": table,
                "queries": queries,
                "transactionId": transaction_id,
                "ttl": 0,
                "total": false
            }
        });
        let value = self
            .replayable_read_json(Method::POST, "/graphql", Some(payload))
            .await?;
        let envelope: GraphQlEnvelope =
            serde_json::from_value(value).map_err(|_| AppwriteError::Unavailable)?;
        if envelope.errors.is_some() {
            return Err(AppwriteError::InvalidRequest);
        }
        let rows = envelope
            .data
            .and_then(|data| data.pointer("/tablesDBListRows/rows").cloned())
            .and_then(|rows| rows.as_array().cloned())
            .ok_or(AppwriteError::Unavailable)?;
        rows.into_iter()
            .map(|row| {
                row.get("data")
                    .and_then(Value::as_str)
                    .ok_or(AppwriteError::Unavailable)
                    .and_then(|data| {
                        serde_json::from_str(data).map_err(|_| AppwriteError::Unavailable)
                    })
            })
            .collect()
    }

    /// Creates a supported `TablesDB` transaction.
    pub async fn create_transaction(&self, ttl_seconds: u16) -> Result<String, AppwriteError> {
        let value = self
            .server_json(
                Method::POST,
                "/tablesdb/transactions",
                Some(json!({ "ttl": ttl_seconds })),
            )
            .await?;
        value
            .get("$id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(AppwriteError::Unavailable)
    }

    /// Stages supported `TablesDB` transaction operations.
    pub async fn stage_operations(
        &self,
        transaction_id: &str,
        operations: Vec<Value>,
    ) -> Result<(), AppwriteError> {
        self.server_json(
            Method::POST,
            &format!("/tablesdb/transactions/{transaction_id}/operations"),
            Some(json!({ "operations": operations })),
        )
        .await
        .map(|_| ())
    }

    /// Commits a supported `TablesDB` transaction.
    pub async fn commit_transaction(&self, transaction_id: &str) -> Result<(), AppwriteError> {
        self.server_json(
            Method::PATCH,
            &format!("/tablesdb/transactions/{transaction_id}"),
            Some(json!({ "commit": true, "rollback": false })),
        )
        .await
        .map(|_| ())
    }

    /// Explicitly rolls back a supported `TablesDB` transaction.
    pub async fn rollback_transaction(&self, transaction_id: &str) -> Result<(), AppwriteError> {
        self.server_json(
            Method::PATCH,
            &format!("/tablesdb/transactions/{transaction_id}"),
            Some(json!({ "commit": false, "rollback": true })),
        )
        .await
        .map(|_| ())
    }

    /// Supported server REST request. Response content never enters an error.
    pub async fn server_json(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AppwriteError> {
        let mut request = self
            .client
            .request(method, format!("{}{}", self.config.endpoint, path))
            .header("X-Appwrite-Project", &self.config.project_id)
            .header("X-Appwrite-Key", &self.config.api_key)
            .header("Cache-Control", "no-store");
        if let Some(value) = &body {
            request = request.json(value);
        }
        // A timeout or lost response can occur after Appwrite accepted a mutation. Never replay a
        // request here. The creation use case resolves ambiguity through its stable creation ID.
        let response = request
            .send()
            .await
            .map_err(|_| AppwriteError::Unavailable)?;
        if !response.status().is_success() {
            return Err(classify(response.status()));
        }
        if response.status() == StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        response
            .json::<Value>()
            .await
            .map_err(|_| AppwriteError::Unavailable)
    }

    async fn replayable_read_json(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AppwriteError> {
        for attempt in 0_u64..=2 {
            match self
                .server_json(method.clone(), path, body.clone())
                .await
            {
                Err(AppwriteError::Unavailable) if attempt < 2 => {
                    tokio::time::sleep(Duration::from_millis(25 * (attempt + 1))).await;
                }
                result => return result,
            }
        }
        Err(AppwriteError::Unavailable)
    }
}

fn classify(status: StatusCode) -> AppwriteError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AppwriteError::Unauthorized,
        StatusCode::NOT_FOUND => AppwriteError::NotFound,
        StatusCode::CONFLICT => AppwriteError::Conflict,
        status if status.is_server_error() => AppwriteError::Unavailable,
        _ => AppwriteError::InvalidRequest,
    }
}
