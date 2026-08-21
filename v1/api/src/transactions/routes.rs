use std::collections::BTreeMap;

use axum::{
    Json, Router,
    extract::{Extension, Path},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::{AuthSession, SessionAccess},
    error::HttpError,
    http::RequestId,
};

use super::{
    EntryDefaults, NewTransaction, Transaction, TransactionError, TransactionService,
    UpdateTransaction,
};

pub fn router<S>(service: TransactionService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/transactions/entry-defaults", get(entry_defaults))
        .route("/transactions", post(create_transaction))
        .route(
            "/transactions/{transaction_id}",
            get(get_transaction)
                .patch(update_transaction)
                .delete(trash_transaction),
        )
        .route(
            "/transactions/{transaction_id}/restore",
            post(restore_transaction),
        )
        .route(
            "/transactions/{transaction_id}/permanent",
            axum::routing::delete(permanently_delete_transaction),
        )
        .layer(Extension(service))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateTransactionRequest {
    wallet_id: Uuid,
    category_id: Uuid,
    direction: String,
    amount: String,
    note: Option<String>,
    occurred_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateTransactionRequest {
    wallet_id: Option<Uuid>,
    category_id: Option<Uuid>,
    direction: Option<String>,
    amount: Option<String>,
    note: Option<Option<String>>,
    occurred_at: Option<String>,
}

async fn entry_defaults(
    Extension(service): Extension<TransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<EntryDefaults>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .entry_defaults(user_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn create_transaction(
    Extension(service): Extension<TransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<CreateTransactionRequest>,
) -> Result<(StatusCode, Json<Transaction>), HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .create(
            user_id,
            NewTransaction {
                wallet_id: body.wallet_id,
                category_id: body.category_id,
                direction: body.direction,
                amount: body.amount,
                note: body.note,
                occurred_at: body.occurred_at,
            },
        )
        .await
        .map(|transaction| (StatusCode::CREATED, Json(transaction)))
        .map_err(|error| map_error(error, request_id))
}

async fn get_transaction(
    Extension(service): Extension<TransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(transaction_id): Path<Uuid>,
) -> Result<Json<Transaction>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .get(user_id, transaction_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn update_transaction(
    Extension(service): Extension<TransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(transaction_id): Path<Uuid>,
    Json(body): Json<UpdateTransactionRequest>,
) -> Result<Json<Transaction>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .update(
            user_id,
            transaction_id,
            UpdateTransaction {
                wallet_id: body.wallet_id,
                category_id: body.category_id,
                direction: body.direction,
                amount: body.amount,
                note: body.note,
                occurred_at: body.occurred_at,
            },
        )
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn trash_transaction(
    Extension(service): Extension<TransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(transaction_id): Path<Uuid>,
) -> Result<Json<Transaction>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .trash(user_id, transaction_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn restore_transaction(
    Extension(service): Extension<TransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(transaction_id): Path<Uuid>,
) -> Result<Json<Transaction>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .restore(user_id, transaction_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn permanently_delete_transaction(
    Extension(service): Extension<TransactionService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(transaction_id): Path<Uuid>,
) -> Result<StatusCode, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .permanently_delete(user_id, transaction_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|error| map_error(error, request_id))
}

fn full_access_user_id(session: AuthSession, request_id: RequestId) -> Result<Uuid, HttpError> {
    if session.access == SessionAccess::Full {
        Ok(session.user_id)
    } else {
        Err(HttpError::forbidden(request_id))
    }
}

fn map_error(error: TransactionError, request_id: RequestId) -> HttpError {
    match error {
        TransactionError::NotFound => HttpError::not_found(request_id),
        TransactionError::ArchivedWallet => validation("wallet_id", request_id),
        TransactionError::ArchivedCategory => validation("category_id", request_id),
        TransactionError::CategoryKindMismatch => validation("category_id", request_id),
        TransactionError::InvalidDirection => validation("direction", request_id),
        TransactionError::InvalidAmount => validation("amount", request_id),
        TransactionError::InvalidNote => validation("note", request_id),
        TransactionError::InvalidOccurredAt => validation("occurred_at", request_id),
        TransactionError::NoChanges => HttpError::validation(BTreeMap::new(), request_id),
        TransactionError::Persistence => HttpError::internal(request_id),
    }
}

fn validation(field: &str, request_id: RequestId) -> HttpError {
    HttpError::validation(
        BTreeMap::from([(field.to_owned(), vec!["invalid".to_owned()])]),
        request_id,
    )
}
