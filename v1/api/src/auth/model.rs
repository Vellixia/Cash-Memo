use std::time::Duration;

use axum::{
    extract::{Extension, FromRequestParts},
    http::request::Parts,
};
use serde::Serialize;
use uuid::Uuid;

use crate::error::HttpError;

use super::AuthService;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionAccess {
    Full,
    DeletionOnly,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthSession {
    pub user_id: Uuid,
    pub access: SessionAccess,
    pub session_id: Uuid,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoginSession {
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub access: SessionAccess,
    pub raw_token: String,
}

#[derive(Clone, Debug)]
pub struct AuthConfig {
    pub idle_timeout: Duration,
    pub absolute_timeout: Duration,
    pub touch_interval: Duration,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            idle_timeout: Duration::from_secs(7 * 24 * 60 * 60),
            absolute_timeout: Duration::from_secs(30 * 24 * 60 * 60),
            touch_interval: Duration::from_secs(60 * 60),
        }
    }
}

impl AuthConfig {
    pub fn for_tests() -> Self {
        Self::default()
    }
}

impl<S> FromRequestParts<S> for AuthSession
where
    S: Send + Sync,
{
    type Rejection = HttpError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let request_id = parts
            .extensions
            .get::<crate::http::RequestId>()
            .cloned()
            .unwrap_or_default();
        let Extension(auth) = Extension::<AuthService>::from_request_parts(parts, state)
            .await
            .map_err(|_| HttpError::unauthorized(request_id.clone()))?;
        let raw_token = parts
            .headers
            .get(axum::http::header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(session_cookie)
            .ok_or_else(|| HttpError::unauthorized(request_id.clone()))?;
        auth.session(raw_token)
            .await
            .map_err(|_| HttpError::unauthorized(request_id))
    }
}

fn session_cookie(header: &str) -> Option<&str> {
    header
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("__Host-cashmemo_session="))
}
