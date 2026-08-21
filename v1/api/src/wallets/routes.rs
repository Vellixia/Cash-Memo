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

use super::{NewWallet, UpdateWallet, Wallet, WalletError, WalletService};

pub fn router<S>(service: WalletService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/wallets", get(list_wallets).post(create_wallet))
        .route(
            "/wallets/{wallet_id}",
            get(get_wallet).patch(update_wallet).delete(delete_wallet),
        )
        .route("/wallets/{wallet_id}/archive", post(archive_wallet))
        .route("/wallets/{wallet_id}/restore", post(restore_wallet))
        .layer(Extension(service))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateWalletRequest {
    name: String,
    currency: String,
    opening_balance: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateWalletRequest {
    name: Option<String>,
    opening_balance: Option<String>,
}

async fn list_wallets(
    Extension(service): Extension<WalletService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<Vec<Wallet>>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .list(user_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn create_wallet(
    Extension(service): Extension<WalletService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<CreateWalletRequest>,
) -> Result<(StatusCode, Json<Wallet>), HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .create(
            user_id,
            NewWallet {
                name: body.name,
                currency: body.currency,
                opening_balance: body.opening_balance,
            },
        )
        .await
        .map(|wallet| (StatusCode::CREATED, Json(wallet)))
        .map_err(|error| map_error(error, request_id))
}

async fn get_wallet(
    Extension(service): Extension<WalletService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(wallet_id): Path<Uuid>,
) -> Result<Json<Wallet>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .get(user_id, wallet_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn update_wallet(
    Extension(service): Extension<WalletService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(wallet_id): Path<Uuid>,
    Json(body): Json<UpdateWalletRequest>,
) -> Result<Json<Wallet>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .update(
            user_id,
            wallet_id,
            UpdateWallet {
                name: body.name,
                opening_balance: body.opening_balance,
            },
        )
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn archive_wallet(
    Extension(service): Extension<WalletService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(wallet_id): Path<Uuid>,
) -> Result<Json<Wallet>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .archive(user_id, wallet_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn restore_wallet(
    Extension(service): Extension<WalletService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(wallet_id): Path<Uuid>,
) -> Result<Json<Wallet>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .restore(user_id, wallet_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn delete_wallet(
    Extension(service): Extension<WalletService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(wallet_id): Path<Uuid>,
) -> Result<StatusCode, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .delete(user_id, wallet_id)
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

fn map_error(error: WalletError, request_id: RequestId) -> HttpError {
    match error {
        WalletError::NotFound => HttpError::not_found(request_id),
        WalletError::HasReferences => HttpError::conflict(request_id),
        WalletError::InvalidName => validation("name", request_id),
        WalletError::InvalidCurrency | WalletError::UnsupportedCurrency => {
            validation("currency", request_id)
        }
        WalletError::InvalidOpeningBalance => validation("opening_balance", request_id),
        WalletError::NoChanges => HttpError::validation(BTreeMap::new(), request_id),
        WalletError::Persistence => HttpError::internal(request_id),
    }
}

fn validation(field: &str, request_id: RequestId) -> HttpError {
    HttpError::validation(
        BTreeMap::from([(field.to_owned(), vec!["invalid".to_owned()])]),
        request_id,
    )
}
