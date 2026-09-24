mod auth;
mod categories;
mod entities;
mod error;
mod memos;

use axum::{Router, extract::State, http::StatusCode, routing::get};
use sea_orm::DatabaseConnection;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub cookie_secure: bool,
}

pub fn app(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .merge(auth::routes())
        .merge(memos::routes())
        .merge(categories::routes());
    Router::new()
        .nest("/api", api)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Liveness + database reachability, for the Dokploy healthcheck.
async fn health(State(st): State<AppState>) -> StatusCode {
    match st.db.ping().await {
        Ok(()) => StatusCode::OK,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

/// ISO 4217-shaped code, uppercased. Shared by memos and user settings.
pub(crate) fn parse_currency(c: &str) -> error::Result<String> {
    let c = c.trim().to_uppercase();
    if c.len() != 3 || !c.chars().all(|ch| ch.is_ascii_uppercase()) {
        return Err(error::AppError::BadRequest(
            "currency must be a 3-letter ISO code",
        ));
    }
    Ok(c)
}

/// Shared by memos and categories.
pub(crate) fn parse_direction(d: &str) -> error::Result<String> {
    match d {
        "income" | "expense" => Ok(d.to_owned()),
        _ => Err(error::AppError::BadRequest(
            "direction must be income or expense",
        )),
    }
}
