mod auth;
mod categories;
mod entities;
mod error;
mod memos;

use axum::{Router, routing::get};
use sea_orm::DatabaseConnection;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub cookie_secure: bool,
}

pub fn app(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(auth::routes())
        .merge(memos::routes())
        .merge(categories::routes());
    Router::new()
        .nest("/api", api)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
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
