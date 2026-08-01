//! Owner-scoped compose label-reference HTTP contract.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{HeaderValue, Request, StatusCode, header};
use cashmemo_application::authorization::{AuthenticatedOwner, SessionValidator};
use cashmemo_application::use_cases::query_label_references::LabelReferenceQuery;
use cashmemo_domain::label::{LabelKind, LabelState};
use cashmemo_domain::{DomainError, Label, LabelId, OwnerId, Revision, Timestamp};
use cashmemo_http_adapter::{AppState, build_router};
use serde_json::Value;
use tower::ServiceExt;

struct ValidSession;

#[async_trait]
impl SessionValidator for ValidSession {
    async fn validate(&self, _session: &str) -> Result<AuthenticatedOwner, DomainError> {
        OwnerId::parse_authenticated_account("label_route_owner")
            .map(AuthenticatedOwner::after_account_validation)
    }
}

struct StaticLabels;

#[async_trait]
impl LabelReferenceQuery for StaticLabels {
    async fn query(
        &self,
        owner: &AuthenticatedOwner,
        kind: LabelKind,
        states: &[LabelState],
    ) -> Result<Vec<Label>, DomainError> {
        assert_eq!(owner.id().as_str(), "label_route_owner");
        assert_eq!(kind, LabelKind::Category);
        assert_eq!(states, [LabelState::Active]);
        Ok(vec![Label {
            id: LabelId::random(),
            owner: owner.id().clone(),
            kind,
            name: "General".to_owned(),
            name_key: "general".to_owned(),
            state: LabelState::Active,
            memo_reference_count: 0,
            revision: Revision::INITIAL,
            created_at: Timestamp::from_micros(1_767_225_600_000_000),
            updated_at: Timestamp::from_micros(1_767_225_600_000_000),
        }])
    }
}

async fn send(body: &'static str) -> axum::response::Response {
    let router = build_router(
        AppState::new(Arc::new(ValidSession)).with_label_references(Arc::new(StaticLabels)),
    );
    let mut request = Request::new(Body::from(body));
    *request.uri_mut() = axum::http::Uri::from_static("/api/v1/labels/query");
    *request.method_mut() = axum::http::Method::POST;
    request.headers_mut().insert(
        header::COOKIE,
        HeaderValue::from_static("cashmemo_session=valid"),
    );
    request.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    match router.oneshot(request).await {
        Ok(response) => response,
        Err(error) => match error {},
    }
}

#[tokio::test]
async fn label_references_are_owner_scoped_and_public_only() {
    let response = send(r#"{"kind":"category","states":["active"]}"#).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 4096).await;
    assert!(bytes.is_ok());
    let body = bytes
        .ok()
        .and_then(|value| serde_json::from_slice::<Value>(&value).ok())
        .unwrap_or(Value::Null);
    assert_eq!(
        body.pointer("/items/0/name").and_then(Value::as_str),
        Some("General")
    );
    assert!(body.pointer("/items/0/ownerId").is_none());
    assert!(body.pointer("/items/0/nameKey").is_none());
    assert!(body.pointer("/items/0/memoReferenceCount").is_none());
}

#[tokio::test]
async fn owner_input_is_rejected_with_stable_problem() {
    let response = send(r#"{"kind":"category","states":["active"],"ownerId":"attacker"}"#).await;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/problem+json")
    );
}
