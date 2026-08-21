use std::{
    collections::{HashMap, VecDeque},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Instant,
};

use axum::{
    body::{Body, to_bytes},
    extract::{ConnectInfo, Request, State},
    http::Method,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::Value;

use crate::{
    config::{AuthRateLimitSettings, RateLimitSettings},
    error::HttpError,
    http::RequestId,
};

const MAX_AUTH_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct AuthRateLimiter {
    settings: AuthRateLimitSettings,
    buckets: Arc<Mutex<HashMap<String, Bucket>>>,
}

struct Bucket {
    attempts: VecDeque<Instant>,
    last_used: Instant,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum EndpointClass {
    Register,
    VerificationResend,
    Login,
    ResetRequest,
}

impl AuthRateLimiter {
    pub fn new(settings: AuthRateLimitSettings) -> Self {
        Self {
            settings,
            buckets: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn check(&self, class: EndpointClass, keys: Vec<String>) -> bool {
        let settings = self.settings.for_class(class);
        let now = Instant::now();
        let mut buckets = self.buckets.lock().expect("rate limiter mutex poisoned");
        buckets.retain(|_, bucket| {
            prune(bucket, settings, now);
            !bucket.attempts.is_empty()
        });

        if keys.iter().any(|key| {
            buckets
                .get(key)
                .is_some_and(|bucket| bucket.attempts.len() >= settings.max_attempts)
        }) {
            return false;
        }

        for key in keys {
            if !buckets.contains_key(&key) && buckets.len() >= settings.max_keys {
                evict_oldest(&mut buckets);
            }
            let bucket = buckets.entry(key).or_insert_with(|| Bucket {
                attempts: VecDeque::new(),
                last_used: now,
            });
            prune(bucket, settings, now);
            bucket.attempts.push_back(now);
            bucket.last_used = now;
        }
        true
    }
}

pub async fn enforce_auth_limit(
    State(limiter): State<AuthRateLimiter>,
    request: Request,
    next: Next,
) -> Response {
    let Some(class) = endpoint_class(request.method(), request.uri().path()) else {
        return next.run(request).await;
    };
    let (request, identifier) = request_with_identifier(request).await;
    let mut keys = vec![format!("{class:?}:ip:{}", client_ip(&request))];
    if let Some(identifier) = identifier {
        keys.push(format!("{class:?}:id:{identifier}"));
    }

    if !limiter.check(class, keys) {
        let request_id = request
            .extensions()
            .get::<RequestId>()
            .cloned()
            .unwrap_or_else(RequestId::new);
        return HttpError::throttled(request_id).into_response();
    }

    next.run(request).await
}

fn endpoint_class(method: &Method, path: &str) -> Option<EndpointClass> {
    if *method != Method::POST {
        return None;
    }
    match path {
        "/api/v1/auth/register" => Some(EndpointClass::Register),
        "/api/v1/auth/verification/resend" => Some(EndpointClass::VerificationResend),
        "/api/v1/auth/login" => Some(EndpointClass::Login),
        "/api/v1/auth/password-reset/request" => Some(EndpointClass::ResetRequest),
        _ => None,
    }
}

async fn request_with_identifier(request: Request) -> (Request, Option<String>) {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, MAX_AUTH_BODY_BYTES)
        .await
        .unwrap_or_default();
    let identifier = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|json| json.get("email")?.as_str().map(normalize_identifier));
    (Request::from_parts(parts, Body::from(bytes)), identifier)
}

fn normalize_identifier(value: &str) -> String {
    value.trim().to_lowercase()
}

fn client_ip(request: &Request) -> String {
    request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| peer.0.ip().to_string())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn prune(bucket: &mut Bucket, settings: &RateLimitSettings, now: Instant) {
    while bucket
        .attempts
        .front()
        .is_some_and(|attempt| now.duration_since(*attempt) >= settings.window)
    {
        bucket.attempts.pop_front();
    }
}

fn evict_oldest(buckets: &mut HashMap<String, Bucket>) {
    if let Some(key) = buckets
        .iter()
        .min_by_key(|(_, bucket)| bucket.last_used)
        .map(|(key, _)| key.clone())
    {
        buckets.remove(&key);
    }
}
