//! Stable redacted HTTP problem responses.

use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cashmemo_domain::DomainError;
use uuid::Uuid;

use crate::contracts::mapping::{http_status, map_error};

/// Domain error rendered with only stable allowlisted fields.
pub struct ProblemResponse(pub DomainError);

impl IntoResponse for ProblemResponse {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(http_status(self.0.code))
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = map_error(&self.0, Uuid::new_v4().to_string());
        let mut response = (status, Json(body)).into_response();
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response
    }
}
