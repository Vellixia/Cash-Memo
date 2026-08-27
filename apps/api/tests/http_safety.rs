use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{HeaderValue, Request, StatusCode, header},
    middleware,
    response::IntoResponse,
    routing::post,
};
use cashmemo_api::app::{AppState, build_app};
use cashmemo_api::{
    config::{AuthRateLimitSettings, RateLimitSettings, TrustedProxyConfig},
    http::{
        rate_limit::{AuthRateLimiter, enforce_auth_limit},
        request_id::attach,
    },
};
use serde_json::{Value, json};
use std::{
    net::{IpAddr, SocketAddr},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

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

fn rate_limited_app(
    trusted_proxy_cidrs: &str,
    max_attempts: usize,
) -> (axum::Router, Arc<AtomicUsize>) {
    let settings = RateLimitSettings {
        max_attempts,
        window: Duration::from_secs(60),
        max_keys: 100,
    };
    let limits = AuthRateLimitSettings {
        register: settings.clone(),
        verification_resend: settings.clone(),
        login: settings.clone(),
        reset_request: settings,
    };
    let handler_hits = Arc::new(AtomicUsize::new(0));
    let handler_counter = handler_hits.clone();
    let limiter = AuthRateLimiter::new(
        limits,
        TrustedProxyConfig::parse(trusted_proxy_cidrs).unwrap(),
    );
    let app = axum::Router::new()
        .route(
            "/api/v1/auth/login",
            post(move || {
                let handler_counter = handler_counter.clone();
                async move {
                    handler_counter.fetch_add(1, Ordering::SeqCst);
                    StatusCode::UNAUTHORIZED.into_response()
                }
            }),
        )
        .layer(middleware::from_fn_with_state(limiter, enforce_auth_limit))
        .layer(middleware::from_fn(attach));
    (app, handler_hits)
}

fn request_from_peer(peer: IpAddr, forwarded_for: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login")
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::new(peer, 43210)));
    if let Some(forwarded_for) = forwarded_for {
        request.headers_mut().insert(
            "x-forwarded-for",
            HeaderValue::from_str(forwarded_for).unwrap(),
        );
    }
    request
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
async fn middleware_rejections_reuse_attached_request_id() {
    for (request, expected_status, request_id) in [
        (
            Request::builder()
                .method("POST")
                .uri("/api/v1/currencies")
                .header("x-request-id", "e4d9df47-895d-4b99-bd83-a3055882d3ba")
                .body(Body::empty())
                .unwrap(),
            StatusCode::FORBIDDEN,
            "e4d9df47-895d-4b99-bd83-a3055882d3ba",
        ),
        (
            Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login")
                .header(header::ORIGIN, "http://localhost:3000")
                .header("x-request-id", "d9e45845-fd78-44c5-9cab-4e6c949544d1")
                .body(Body::empty())
                .unwrap(),
            StatusCode::BAD_REQUEST,
            "d9e45845-fd78-44c5-9cab-4e6c949544d1",
        ),
    ] {
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), expected_status);
        assert_eq!(response.headers()["x-request-id"], request_id);
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["error"]["request_id"], request_id);
    }
}

#[tokio::test]
async fn auth_json_rejections_keep_canonical_error_envelope_and_request_id() {
    let endpoints = [
        "/api/v1/auth/register",
        "/api/v1/auth/verify-email",
        "/api/v1/auth/verification/resend",
        "/api/v1/auth/login",
        "/api/v1/auth/password-reset/request",
        "/api/v1/auth/password-reset/consume",
    ];
    for (kind, content_type, body) in [
        (
            "malformed JSON",
            Some("application/json"),
            r#"{"email":"sensitive-malformed@example.test","password":"malformed-secret"#,
        ),
        (
            "missing Content-Type",
            None,
            r#"{"email":"sensitive-missing@example.test","password":"missing-secret"}"#,
        ),
        (
            "wrong Content-Type",
            Some("text/plain"),
            r#"{"email":"sensitive-wrong@example.test","password":"wrong-secret"}"#,
        ),
    ] {
        for endpoint in endpoints {
            let request_id = uuid::Uuid::new_v4().to_string();
            let mut request = Request::builder()
                .method("POST")
                .uri(endpoint)
                .header(header::ORIGIN, "http://localhost:3000")
                .header("x-request-id", &request_id)
                .body(Body::from(body))
                .unwrap();
            if let Some(content_type) = content_type {
                request
                    .headers_mut()
                    .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
            }
            request
                .extensions_mut()
                .insert(ConnectInfo(SocketAddr::from(([198, 51, 100, 44], 43210))));

            let response = app().oneshot(request).await.unwrap();
            assert_eq!(
                response.status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "{kind}: {endpoint}"
            );
            assert_eq!(
                response.headers()["x-request-id"],
                request_id,
                "{kind}: {endpoint}"
            );
            let response_body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let response_text = std::str::from_utf8(&response_body).unwrap();
            for secret in [
                "sensitive-malformed@example.test",
                "malformed-secret",
                "sensitive-missing@example.test",
                "missing-secret",
                "sensitive-wrong@example.test",
                "wrong-secret",
            ] {
                assert!(
                    !response_text.contains(secret),
                    "{kind}: {endpoint} echoed {secret}: {response_text}"
                );
            }
            let response_body: Value = serde_json::from_slice(&response_body).unwrap();
            assert_eq!(
                response_body,
                json!({
                    "error": {
                        "code": "VALIDATION_FAILED",
                        "message": "Check the highlighted fields.",
                        "fields": {},
                        "request_id": request_id,
                    }
                }),
                "{kind}: {endpoint}"
            );
        }
    }
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
            .oneshot(request_from_peer(IpAddr::from([198, 51, 100, 44]), None))
            .await
            .unwrap()
            .status();
    }

    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

#[test]
fn trusted_proxy_configuration_rejects_invalid_cidrs() {
    let error = TrustedProxyConfig::parse("10.0.0.0/8,not-a-cidr").unwrap_err();
    assert!(
        error
            .to_string()
            .contains("CASHMEMO_V1_TRUSTED_PROXY_CIDRS"),
        "error: {error}"
    );
    assert!(TrustedProxyConfig::parse("").unwrap().cidrs.is_empty());
}

#[tokio::test]
async fn direct_untrusted_peer_is_authoritative_and_forwarded_spoofs_are_ignored() {
    let (app, handler_hits) = rate_limited_app("", 2);
    let peer = IpAddr::from([198, 51, 100, 44]);

    for spoof in ["203.0.113.8", "192.0.2.90"] {
        let response = app
            .clone()
            .oneshot(request_from_peer(peer, Some(spoof)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    let response = app
        .oneshot(request_from_peer(peer, Some("203.0.113.200")))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(handler_hits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn trusted_proxy_chain_strips_only_trusted_suffix() {
    let (app, handler_hits) = rate_limited_app("10.0.0.0/8", 1);
    let proxy = IpAddr::from([10, 0, 0, 2]);

    let first = app
        .clone()
        .oneshot(request_from_peer(proxy, Some("203.0.113.8, 10.0.0.3")))
        .await
        .unwrap();
    let second = app
        .oneshot(request_from_peer(proxy, Some("203.0.113.8, 10.0.0.99")))
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(handler_hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn two_clients_behind_one_trusted_proxy_keep_distinct_ip_buckets() {
    let (app, handler_hits) = rate_limited_app("10.0.0.0/8", 1);
    let proxy = IpAddr::from([10, 0, 0, 2]);

    for client in ["203.0.113.8", "203.0.113.9"] {
        let response = app
            .clone()
            .oneshot(request_from_peer(proxy, Some(client)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{client}");
    }
    let repeated = app
        .oneshot(request_from_peer(proxy, Some("203.0.113.8")))
        .await
        .unwrap();

    assert_eq!(repeated.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(handler_hits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn hostile_left_prefix_is_not_parsed_after_real_rightmost_client() {
    let (app, handler_hits) = rate_limited_app("10.0.0.0/8", 1);
    let proxy = IpAddr::from([10, 0, 0, 2]);

    let first = app
        .clone()
        .oneshot(request_from_peer(
            proxy,
            Some("malformed-prefix, 203.0.113.8"),
        ))
        .await
        .unwrap();
    let second = app
        .oneshot(request_from_peer(proxy, Some("203.0.113.8")))
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(handler_hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn trusted_address_inside_untrusted_chain_grants_no_trust() {
    let (app, handler_hits) = rate_limited_app("10.0.0.0/8", 1);
    let proxy = IpAddr::from([10, 0, 0, 2]);

    let first = app
        .clone()
        .oneshot(request_from_peer(proxy, Some("10.9.8.7, 198.51.100.7")))
        .await
        .unwrap();
    let second = app
        .oneshot(request_from_peer(proxy, Some("192.0.2.9, 198.51.100.7")))
        .await
        .unwrap();

    assert_eq!(first.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(handler_hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn malformed_or_excessive_trusted_suffix_fails_before_auth_handler() {
    let (app, handler_hits) = rate_limited_app("10.0.0.0/8", 5);
    let proxy = IpAddr::from([10, 0, 0, 2]);
    let too_many_hops = std::iter::repeat_n("10.0.0.3", 17)
        .collect::<Vec<_>>()
        .join(", ");
    let too_many_bytes = "x".repeat(2049);
    let oversized_header_with_rightmost_client =
        format!("{}, 203.0.113.8", "hostile-prefix".repeat(630));

    for forwarded_for in [
        None,
        Some("10.0.0.3"),
        Some("203.0.113.8, malformed"),
        Some(&too_many_hops),
        Some(&too_many_bytes),
        Some(&oversized_header_with_rightmost_client),
    ] {
        let response = app
            .clone()
            .oneshot(request_from_peer(proxy, forwarded_for))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "{forwarded_for:?}"
        );
    }

    assert_eq!(handler_hits.load(Ordering::SeqCst), 0);
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
