//! Owner-scoped label reference endpoint.

use std::collections::BTreeSet;

use axum::Json;
use axum::extract::State;
use axum::extract::rejection::JsonRejection;
use cashmemo_domain::label::{LabelKind, LabelState};
use cashmemo_domain::{DomainError, ErrorCode};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::Principal;
use crate::problem::ProblemResponse;
use crate::router::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RequestKind {
    Category,
    MoneySpace,
}

#[derive(Clone, Copy, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
enum RequestState {
    Active,
    Deactivated,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LabelQueryRequest {
    kind: RequestKind,
    states: Vec<RequestState>,
}

/// Lists compose/filter references without exposing persistence fields.
pub(crate) async fn query_labels(
    State(state): State<AppState>,
    Principal(owner): Principal,
    payload: Result<Json<LabelQueryRequest>, JsonRejection>,
) -> Result<Json<Value>, ProblemResponse> {
    let Json(request) = payload.map_err(|_| {
        ProblemResponse(DomainError::safe(
            ErrorCode::ValidationFailed,
            "request body is invalid",
        ))
    })?;
    let unique = request.states.iter().copied().collect::<BTreeSet<_>>();
    if unique.is_empty() || unique.len() != request.states.len() {
        return Err(ProblemResponse(DomainError::safe(
            ErrorCode::ValidationFailed,
            "label states are invalid",
        )));
    }
    let kind = match request.kind {
        RequestKind::Category => LabelKind::Category,
        RequestKind::MoneySpace => LabelKind::MoneySpace,
    };
    let states = unique
        .into_iter()
        .map(|state| match state {
            RequestState::Active => LabelState::Active,
            RequestState::Deactivated => LabelState::Deactivated,
        })
        .collect::<Vec<_>>();
    let query = state.label_references().ok_or_else(|| {
        ProblemResponse(DomainError::retryable(
            ErrorCode::DependencyUnavailable,
            "label references unavailable",
        ))
    })?;
    let items = query
        .query(&owner, kind, &states)
        .await
        .map_err(ProblemResponse)?
        .into_iter()
        .map(|label| {
            Ok(json!({
                "id": label.id.to_string(),
                "kind": match label.kind { LabelKind::Category => "category", LabelKind::MoneySpace => "money_space" },
                "name": label.name,
                "state": match label.state { LabelState::Active => "active", LabelState::Deactivated => "deactivated" },
                "revision": label.revision.get(),
                "createdAt": label.created_at.to_canonical()?,
                "updatedAt": label.updated_at.to_canonical()?
            }))
        })
        .collect::<Result<Vec<_>, DomainError>>()
        .map_err(ProblemResponse)?;
    Ok(Json(json!({ "items": items })))
}
