use axum::{
    body::{Body, to_bytes},
    http::{HeaderValue, Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use serde_json::Value;
use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

fn app() -> axum::Router {
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(50))
        .connect_lazy("postgres://cashmemo:cashmemo@127.0.0.1:1/cashmemo")
        .unwrap();

    build_app(AppState { pool })
}

#[tokio::test]
async fn unsafe_request_requires_exact_origin() {
    for origin in [
        None,
        Some("http://localhost:3000.evil.test"),
        Some("https://evil.test"),
    ] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/v1/currencies")
            .body(Body::empty())
            .unwrap();
        if let Some(origin) = origin {
            request
                .headers_mut()
                .insert(header::ORIGIN, origin.parse().unwrap());
        }

        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{origin:?}");
    }

    let response = app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/currencies")
                .header(header::ORIGIN, "http://localhost:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn canonical_request_id_is_returned_in_header_and_error() {
    let inbound = "c5c2b736-c4bc-48ea-98a1-239d0e4f8f35";
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/missing")
                .header("x-request-id", inbound)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(response.headers()["x-request-id"], inbound);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["error"]["code"], "NOT_FOUND");
    assert_eq!(body["error"]["request_id"], inbound);

    let response = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/missing")
                .header("x-request-id", HeaderValue::from_static("not-a-request-id"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let generated = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    assert_ne!(generated, "not-a-request-id");
    assert!(Uuid::parse_str(&generated).is_ok());
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["error"]["request_id"], generated);

    let response = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/currencies")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let request_id = response.headers()["x-request-id"]
        .to_str()
        .unwrap()
        .to_owned();
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["error"]["code"], "INTERNAL_SERVER_ERROR");
    assert_eq!(body["error"]["request_id"], request_id);
}

#[tokio::test]
async fn api_responses_use_no_store_cache_policy() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/missing")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
}

#[tokio::test]
async fn auth_limit_returns_429_without_persistent_attempt_rows() {
    let app = app();
    let mut status = StatusCode::OK;
    for _ in 0..6 {
        status = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/auth/login")
                    .header(header::ORIGIN, "http://localhost:3000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status();
    }

    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn health_contract_uses_versioned_live_and_ready_paths() {
    let live = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/live")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(live.status(), StatusCode::OK);

    let ready = app()
        .oneshot(
            Request::builder()
                .uri("/api/v1/health/ready")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ready.status(), StatusCode::SERVICE_UNAVAILABLE);

    for path in ["/health", "/ready"] {
        let response = app()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}
