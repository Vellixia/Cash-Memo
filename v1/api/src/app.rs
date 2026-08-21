use axum::Router;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

pub fn build_app(state: AppState) -> Router {
    Router::new().with_state(state)
}
