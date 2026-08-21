use std::collections::BTreeMap;

use axum::{
    Json, Router,
    extract::{Extension, Path},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use super::{
    NewRecurringTransaction, RecurringError, RecurringTransaction, RecurringTransactionService,
};
use crate::{
    auth::{AuthSession, SessionAccess},
    error::HttpError,
    http::RequestId,
};

pub fn router<S>(service: RecurringTransactionService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/recurring-transactions", get(list).post(create))
        .route(
            "/recurring-transactions/{id}",
            get(get_one).patch(update).delete(delete),
        )
        .route("/recurring-transactions/{id}/pause", post(pause))
        .route("/recurring-transactions/{id}/resume", post(resume))
        .layer(Extension(service))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRequest {
    wallet_id: Uuid,
    category_id: Uuid,
    direction: String,
    amount: String,
    note: Option<String>,
    frequency: String,
    start_date: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateRequest {
    wallet_id: Option<Uuid>,
    category_id: Option<Uuid>,
    direction: Option<String>,
    amount: Option<String>,
    note: Option<Option<String>>,
    frequency: Option<String>,
    start_date: Option<String>,
}

async fn list(
    Extension(service): Extension<RecurringTransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<Vec<RecurringTransaction>>, HttpError> {
    service
        .list(user_id(session, request_id.clone())?)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}
async fn get_one(
    Extension(service): Extension<RecurringTransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<Json<RecurringTransaction>, HttpError> {
    service
        .get(user_id(session, request_id.clone())?, id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}
async fn create(
    Extension(service): Extension<RecurringTransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<CreateRequest>,
) -> Result<(StatusCode, Json<RecurringTransaction>), HttpError> {
    service
        .create(
            user_id(session, request_id.clone())?,
            NewRecurringTransaction {
                wallet_id: body.wallet_id,
                category_id: body.category_id,
                direction: body.direction,
                amount: body.amount,
                note: body.note,
                frequency: body.frequency,
                start_date: body.start_date,
            },
        )
        .await
        .map(|value| (StatusCode::CREATED, Json(value)))
        .map_err(|error| map_error(error, request_id))
}
async fn update(
    Extension(service): Extension<RecurringTransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateRequest>,
) -> Result<Json<RecurringTransaction>, HttpError> {
    service
        .update(
            user_id(session, request_id.clone())?,
            id,
            super::UpdateRecurringTransaction {
                wallet_id: body.wallet_id,
                category_id: body.category_id,
                direction: body.direction,
                amount: body.amount,
                note: body.note,
                frequency: body.frequency,
                start_date: body.start_date,
            },
        )
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}
async fn pause(
    Extension(service): Extension<RecurringTransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<Json<RecurringTransaction>, HttpError> {
    service
        .pause(user_id(session, request_id.clone())?, id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}
async fn resume(
    Extension(service): Extension<RecurringTransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<Json<RecurringTransaction>, HttpError> {
    service
        .resume(user_id(session, request_id.clone())?, id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}
async fn delete(
    Extension(service): Extension<RecurringTransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, HttpError> {
    service
        .pause(user_id(session, request_id.clone())?, id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|error| map_error(error, request_id))
}
fn user_id(session: AuthSession, request_id: RequestId) -> Result<Uuid, HttpError> {
    (session.access == SessionAccess::Full)
        .then_some(session.user_id)
        .ok_or_else(|| HttpError::forbidden(request_id))
}
fn map_error(error: RecurringError, request_id: RequestId) -> HttpError {
    match error {
        RecurringError::NotFound => HttpError::not_found(request_id),
        RecurringError::NoChanges => HttpError::validation(BTreeMap::new(), request_id),
        RecurringError::ArchivedWallet => validation("wallet_id", request_id),
        RecurringError::ArchivedCategory | RecurringError::CategoryKindMismatch => {
            validation("category_id", request_id)
        }
        RecurringError::InvalidDirection => validation("direction", request_id),
        RecurringError::InvalidAmount => validation("amount", request_id),
        RecurringError::InvalidNote => validation("note", request_id),
        RecurringError::InvalidFrequency => validation("frequency", request_id),
        RecurringError::InvalidStartDate => validation("start_date", request_id),
        RecurringError::Persistence => HttpError::internal(request_id),
    }
}
fn validation(field: &str, request_id: RequestId) -> HttpError {
    HttpError::validation(
        BTreeMap::from([(field.to_owned(), vec!["invalid".to_owned()])]),
        request_id,
    )
}
