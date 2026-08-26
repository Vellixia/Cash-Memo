use axum::{
    Json, Router,
    extract::Extension,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use super::{AccountDeletionError, AccountDeletionService, AccountStatus};
use crate::{
    auth::{AuthSession, SessionAccess, cookie::clear_session_cookie},
    error::HttpError,
    http::RequestId,
};

pub fn router<S>(service: AccountDeletionService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/account/deletion", get(status).post(request))
        .route("/account/deletion/cancel", post(cancel))
        .layer(Extension(service))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeletionRequest {
    password: String,
}

#[derive(Serialize)]
struct DeletionResponse {
    status: &'static str,
    deletion_due_at: Option<String>,
}

async fn request(
    Extension(service): Extension<AccountDeletionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<DeletionRequest>,
) -> Result<Response, HttpError> {
    if session.access != SessionAccess::Full {
        return Err(HttpError::forbidden(request_id));
    }
    let status = service
        .request(session.user_id, &body.password)
        .await
        .map(response)
        .map_err(|error| map_error(error, request_id))?;
    let mut response = Json(status).into_response();
    clear_session_cookie(&mut response);
    Ok(response)
}

async fn status(
    Extension(service): Extension<AccountDeletionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Response, HttpError> {
    service
        .status(session.user_id)
        .await
        .map(response)
        .map(Json)
        .map(axum::Json::into_response)
        .map_err(|error| map_error(error, request_id))
}

async fn cancel(
    Extension(service): Extension<AccountDeletionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<DeletionRequest>,
) -> Result<Response, HttpError> {
    service
        .cancel(session.user_id, &body.password)
        .await
        .map_err(|error| map_error(error, request_id.clone()))?;
    let status = service
        .status(session.user_id)
        .await
        .map(response)
        .map_err(|error| map_error(error, request_id))?;
    let mut response = Json(status).into_response();
    clear_session_cookie(&mut response);
    Ok(response)
}

fn response(status: super::DeletionStatus) -> DeletionResponse {
    DeletionResponse {
        status: match status.status {
            AccountStatus::Active => "active",
            AccountStatus::PendingDeletion => "pending_deletion",
            AccountStatus::Purging => "purging",
        },
        deletion_due_at: status
            .deletion_due_at
            .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
    }
}

fn map_error(error: AccountDeletionError, request_id: RequestId) -> HttpError {
    match error {
        AccountDeletionError::RecentPasswordRequired => HttpError::invalid_credentials(request_id),
        AccountDeletionError::NotPending => HttpError::conflict(request_id),
        AccountDeletionError::Persistence
        | AccountDeletionError::ClaimLost
        | AccountDeletionError::Receipt => HttpError::internal(request_id),
    }
}
