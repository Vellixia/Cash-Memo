//! Authentication boundary contract. No credential or owner value is printed on failure.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use cashmemo_application::authorization::{AuthenticatedOwner, SessionValidator};
use cashmemo_domain::{DomainError, ErrorCode, OwnerId};
use cashmemo_http_adapter::{AppState, build_router};
use serde_json::Value;
use tower::ServiceExt;

struct ScenarioValidator;

#[async_trait]
impl SessionValidator for ScenarioValidator {
    async fn validate(&self, session: &str) -> Result<AuthenticatedOwner, DomainError> {
        match session {
            "valid-session" => Ok(AuthenticatedOwner::after_account_validation(
                OwnerId::parse_authenticated_account("valid_owner")?,
            )),
            "dependency-down" => Err(DomainError::retryable(
                ErrorCode::DependencyUnavailable,
                "authentication dependency unavailable",
            )),
            _ => Err(DomainError::safe(
                ErrorCode::AuthRequired,
                "authentication required",
            )),
        }
    }
}

async fn request(cookie: Option<&str>) -> axum::response::Response {
    let router = build_router(AppState::new(Arc::new(ScenarioValidator)));
    let mut request = Request::new(Body::empty());
    *request.uri_mut() = axum::http::Uri::from_static("/api/v1/reference/currencies");
    if let Some(value) = cookie
        && let Ok(value) = axum::http::HeaderValue::from_str(value)
    {
        request.headers_mut().insert(header::COOKIE, value);
    }
    match router.oneshot(request).await {
        Ok(response) => response,
        Err(error) => match error {},
    }
}

#[tokio::test]
async fn missing_expired_and_revoked_sessions_fail_closed() {
    for cookie in [
        None,
        Some("cashmemo_session=expired"),
        Some("cashmemo_session=revoked"),
    ] {
        let response = request(cookie).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok()),
            Some("no-store")
        );
    }
}

#[tokio::test]
async fn account_api_failure_is_not_treated_as_anonymous_or_authenticated() {
    let response = request(Some("cashmemo_session=dependency-down")).await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-store")
    );
}

#[tokio::test]
async fn valid_session_reaches_protected_route_without_owner_input() {
    let response = request(Some("other=value; cashmemo_session=valid-session")).await;
    assert_eq!(response.status(), StatusCode::OK);

    let value = serde_json::json!({
        "creationId": "123e4567-e89b-42d3-a456-426614174000",
        "type": "expense",
        "amount": "1.00",
        "currency": "USD",
        "occurrence": {
            "instant": "2026-01-01T00:00:00.000000Z",
            "localWallTime": "2026-01-01T00:00:00.000000",
            "utcOffset": "+00:00"
        },
        "categoryId": "123e4567-e89b-42d3-a456-426614174001",
        "moneySpaceId": "123e4567-e89b-42d3-a456-426614174002",
        "note": null,
        "plannedStatus": "unplanned",
        "purpose": "personal",
        "ownerId": "attacker_controlled"
    });
    let parsed = serde_json::from_value::<
        cashmemo_http_adapter::contracts::generated::MoneyMemoCreateRequest,
    >(value);
    assert!(parsed.is_err(), "request DTO must reject owner input");

    let body = axum::body::to_bytes(
        request(Some("cashmemo_session=expired")).await.into_body(),
        4096,
    )
    .await;
    assert!(body.is_ok());
    let safe_error = body
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    assert_eq!(
        safe_error.get("code").and_then(Value::as_str),
        Some("AUTH_REQUIRED")
    );
    assert!(safe_error.get("ownerId").is_none());
}

#[tokio::test]
async fn session_bootstrap_is_live_protected_and_returns_only_current_account() {
    let router = build_router(AppState::new(Arc::new(ScenarioValidator)));
    let response = router
        .oneshot(
            Request::get("/api/v1/auth/session")
                .header(header::COOKIE, "cashmemo_session=valid-session")
                .body(Body::empty())
                .unwrap_or_else(|_| panic!("request build failed")),
        )
        .await
        .unwrap_or_else(|error| match error {});
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 4096)
        .await
        .unwrap_or_else(|_| panic!("response body unavailable"));
    let value: Value =
        serde_json::from_slice(&body).unwrap_or_else(|_| panic!("response JSON unavailable"));
    assert_eq!(
        value.get("accountId").and_then(Value::as_str),
        Some("valid_owner")
    );
    assert_eq!(value.as_object().map(serde_json::Map::len), Some(1));

    let rejected = build_router(AppState::new(Arc::new(ScenarioValidator)))
        .oneshot(
            Request::get("/api/v1/auth/session")
                .body(Body::empty())
                .unwrap_or_else(|_| panic!("request build failed")),
        )
        .await
        .unwrap_or_else(|error| match error {});
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}
