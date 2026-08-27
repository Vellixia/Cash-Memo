use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
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
    config::{AuthRateLimitSettings, RateLimitSettings, TrustedProxyConfig},
    error::HttpError,
    http::RequestId,
};

const MAX_AUTH_BODY_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub struct AuthRateLimiter {
    settings: AuthRateLimitSettings,
    trusted_proxies: TrustedProxyConfig,
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
    pub fn new(settings: AuthRateLimitSettings, trusted_proxies: TrustedProxyConfig) -> Self {
        Self {
            settings,
            trusted_proxies,
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
    let client = match effective_client(&request, &limiter.trusted_proxies) {
        Ok(client) => client,
        Err(_) => {
            let request_id = request
                .extensions()
                .get::<RequestId>()
                .cloned()
                .expect("request ID middleware must run before rate limiting");
            return HttpError::invalid_forwarding(request_id).into_response();
        }
    };
    let (request, identifier) = request_with_identifier(request).await;
    let mut keys = vec![format!("{class:?}:ip:{client}")];
    if let Some(identifier) = identifier {
        keys.push(format!("{class:?}:id:{identifier}"));
    }

    if !limiter.check(class, keys) {
        let request_id = request
            .extensions()
            .get::<RequestId>()
            .cloned()
            .expect("request ID middleware must run before rate limiting");
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EffectiveClientError {
    MissingPeer,
    InvalidForwarding,
}

pub fn effective_client(
    request: &Request,
    trusted_proxies: &TrustedProxyConfig,
) -> Result<IpAddr, EffectiveClientError> {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| peer.0.ip())
        .ok_or(EffectiveClientError::MissingPeer)?;
    if !trusted_proxies.trusts(peer) {
        return Ok(peer);
    }

    let values = request.headers().get_all("x-forwarded-for");
    if values.iter().next().is_none() {
        return Err(EffectiveClientError::InvalidForwarding);
    }
    let header_bytes = values
        .iter()
        .enumerate()
        .try_fold(0usize, |total, (index, value)| {
            total
                .checked_add(value.as_bytes().len())?
                .checked_add(usize::from(index > 0))
        });
    if header_bytes.is_none_or(|bytes| bytes > trusted_proxies.edge_max_header_bytes) {
        return Err(EffectiveClientError::InvalidForwarding);
    }

    let mut inspected_bytes = 0usize;
    let mut inspected_hops = 0usize;
    for value in values.iter().rev() {
        for raw_hop in value.as_bytes().rsplit(|byte| *byte == b',') {
            inspected_bytes = inspected_bytes
                .checked_add(raw_hop.len() + usize::from(inspected_hops > 0))
                .ok_or(EffectiveClientError::InvalidForwarding)?;
            inspected_hops += 1;
            if inspected_bytes > trusted_proxies.rust_suffix_bytes
                || inspected_hops > trusted_proxies.max_hops
            {
                return Err(EffectiveClientError::InvalidForwarding);
            }
            let hop = trim_ascii_whitespace(raw_hop);
            let address = std::str::from_utf8(hop)
                .ok()
                .and_then(|hop| hop.parse::<IpAddr>().ok())
                .ok_or(EffectiveClientError::InvalidForwarding)?;
            if !trusted_proxies.trusts(address) {
                return Ok(address);
            }
        }
    }

    Err(EffectiveClientError::InvalidForwarding)
}

fn trim_ascii_whitespace(mut value: &[u8]) -> &[u8] {
    while value.first().is_some_and(u8::is_ascii_whitespace) {
        value = &value[1..];
    }
    while value.last().is_some_and(u8::is_ascii_whitespace) {
        value = &value[..value.len() - 1];
    }
    value
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
