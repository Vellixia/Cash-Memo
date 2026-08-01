#![allow(dead_code)]

use std::env;

use cashmemo_appwrite_adapter::AppwriteConfig;
use reqwest::Method;
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Clone)]
pub struct TestEnvironment {
    pub config: AppwriteConfig,
    client: reqwest::Client,
}

pub struct UserSession {
    pub user_id: String,
    pub session_id: String,
    pub secret: String,
}

impl TestEnvironment {
    pub fn from_environment() -> Result<Self, String> {
        let config = AppwriteConfig {
            endpoint: env::var("APPWRITE_ENDPOINT").map_err(|_| "APPWRITE_ENDPOINT required")?,
            project_id: env::var("APPWRITE_PROJECT_ID")
                .map_err(|_| "APPWRITE_PROJECT_ID required")?,
            api_key: env::var("APPWRITE_SERVER_API_KEY")
                .map_err(|_| "APPWRITE_SERVER_API_KEY required")?,
            database_id: env::var("APPWRITE_DATABASE_ID").unwrap_or_else(|_| "cashmemo".to_owned()),
        };
        Ok(Self {
            config,
            client: reqwest::Client::new(),
        })
    }

    pub async fn create_user_session(&self) -> Result<UserSession, String> {
        let user_id = format!("u{}", Uuid::new_v4().simple());
        let password = format!("T9-{}", Uuid::new_v4().simple());
        self.server(
            Method::POST,
            "/users",
            Some(json!({
                "userId": user_id,
                "email": format!("{user_id}@cashmemo.test"),
                "password": password,
                "name": "Integration User"
            })),
        )
        .await?;
        let session = self
            .server(
                Method::POST,
                &format!("/users/{user_id}/sessions"),
                Some(json!({})),
            )
            .await?;
        Ok(UserSession {
            user_id,
            session_id: required_string(&session, "$id")?,
            secret: required_string(&session, "secret")?,
        })
    }

    pub async fn revoke_session(&self, user: &UserSession) -> Result<(), String> {
        self.server(
            Method::DELETE,
            &format!("/users/{}/sessions/{}", user.user_id, user.session_id),
            None,
        )
        .await
        .map(|_| ())
    }

    pub async fn delete_user(&self, user_id: &str) -> Result<(), String> {
        self.server(Method::DELETE, &format!("/users/{user_id}"), None)
            .await
            .map(|_| ())
    }

    pub async fn server(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut request = self
            .client
            .request(
                method,
                format!("{}{}", self.config.endpoint.trim_end_matches('/'), path),
            )
            .header("X-Appwrite-Project", &self.config.project_id)
            .header("X-Appwrite-Key", &self.config.api_key);
        if let Some(value) = body {
            request = request.json(&value);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Appwrite request failed")?;
        if !response.status().is_success() {
            return Err(format!(
                "Appwrite supported API returned HTTP {}",
                response.status().as_u16()
            ));
        }
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        response
            .json()
            .await
            .map_err(|_| "Appwrite JSON response unavailable".to_owned())
    }

    pub async fn direct(
        &self,
        method: Method,
        path: &str,
        session: Option<&str>,
    ) -> Result<(u16, Value), String> {
        let mut request = self
            .client
            .request(
                method,
                format!("{}{}", self.config.endpoint.trim_end_matches('/'), path),
            )
            .header("X-Appwrite-Project", &self.config.project_id);
        if let Some(secret) = session {
            request = request.header("X-Appwrite-Session", secret);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Appwrite request failed")?;
        let status = response.status().as_u16();
        let value = response.json().await.unwrap_or(Value::Null);
        Ok((status, value))
    }
}

fn required_string(value: &Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "Appwrite response field unavailable".to_owned())
}
