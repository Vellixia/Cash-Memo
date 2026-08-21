use axum::{Json, Router, http::StatusCode, routing::get};
use sqlx::PgPool;

use crate::currency::{CurrencyRepository, EnabledCurrencyResponse};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

pub fn build_app(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/currencies", get(list_currencies))
        .with_state(state)
}

async fn list_currencies(
    state: axum::extract::State<AppState>,
) -> Result<Json<Vec<EnabledCurrencyResponse>>, StatusCode> {
    CurrencyRepository::enabled(&state.pool)
        .await
        .map(|currencies| Json(currencies.into_iter().map(Into::into).collect()))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
