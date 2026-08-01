//! Opaque SSR-cookie extraction and live principal validation.

use axum::extract::FromRequestParts;
use axum::http::header;
use axum::http::request::Parts;
use cashmemo_application::authorization::AuthenticatedOwner;
use cashmemo_domain::{DomainError, ErrorCode};

use crate::problem::ProblemResponse;
use crate::router::AppState;

/// Local extractor wrapper around the application-owned capability.
#[derive(Clone, Debug)]
pub struct Principal(pub AuthenticatedOwner);

impl FromRequestParts<AppState> for Principal {
    type Rejection = ProblemResponse;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = session_cookie(parts).ok_or_else(auth_required)?;
        state
            .session_validator()
            .validate(&session)
            .await
            .map(Self)
            .map_err(ProblemResponse)
    }
}

fn session_cookie(parts: &Parts) -> Option<String> {
    let mut found = None;
    for header_value in parts.headers.get_all(header::COOKIE) {
        let value = header_value.to_str().ok()?;
        for pair in value.split(';') {
            let (name, candidate) = pair.trim().split_once('=')?;
            if name == "cashmemo_session" {
                if candidate.is_empty() || candidate.len() > 4096 || found.is_some() {
                    return None;
                }
                found = Some(candidate.to_owned());
            }
        }
    }
    found
}

fn auth_required() -> ProblemResponse {
    ProblemResponse(DomainError::safe(
        ErrorCode::AuthRequired,
        "authentication required",
    ))
}
