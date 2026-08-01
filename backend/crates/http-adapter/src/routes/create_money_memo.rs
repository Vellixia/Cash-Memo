//! `POST /v1/money-memos` reviewed create boundary.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use cashmemo_domain::create::CreateCandidate;

use crate::auth::Principal;
use crate::contracts::generated::MoneyMemoCreateRequest;
use crate::contracts::mapping::map_money_memo;
use crate::problem::ProblemResponse;
use crate::router::AppState;

/// Creates or returns current matching retry without exposing examined content.
pub async fn create_money_memo(
    Principal(owner): Principal,
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<MoneyMemoCreateRequest>,
) -> Result<Response, ProblemResponse> {
    let candidate = CreateCandidate {
        creation_id: request.creation_id,
        memo_type: Some(match request.memo_type {
            crate::contracts::generated::MoneyMemoType::Income => {
                cashmemo_domain::money_memo::MoneyMemoType::Income
            }
            crate::contracts::generated::MoneyMemoType::Expense => {
                cashmemo_domain::money_memo::MoneyMemoType::Expense
            }
        }),
        amount: request.amount,
        currency: request.currency,
        occurrence_instant: request.occurrence.instant,
        occurrence_local_wall: request.occurrence.local_wall_time,
        occurrence_offset: request.occurrence.utc_offset,
        category_id: request.category_id,
        money_space_id: request.money_space_id,
        note: request.note,
        planned_status: Some(match request.planned_status {
            crate::contracts::generated::PlannedStatus::Planned => {
                cashmemo_domain::money_memo::PlannedStatus::Planned
            }
            crate::contracts::generated::PlannedStatus::Unplanned => {
                cashmemo_domain::money_memo::PlannedStatus::Unplanned
            }
        }),
        purpose: Some(match request.purpose {
            crate::contracts::generated::Purpose::Personal => {
                cashmemo_domain::money_memo::Purpose::Personal
            }
            crate::contracts::generated::Purpose::Work => {
                cashmemo_domain::money_memo::Purpose::Work
            }
            crate::contracts::generated::Purpose::Mixed => {
                cashmemo_domain::money_memo::Purpose::Mixed
            }
        }),
    };
    let creator = state.money_memo_creator().ok_or_else(|| {
        ProblemResponse(cashmemo_domain::DomainError::retryable(
            cashmemo_domain::ErrorCode::DependencyUnavailable,
            "creation service unavailable",
        ))
    })?;
    let outcome = creator
        .create(&owner, candidate)
        .await
        .map_err(ProblemResponse)?;
    let status = if outcome.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    let response = map_money_memo(&outcome.memo).map_err(ProblemResponse)?;
    Ok((status, Json(response)).into_response())
}
