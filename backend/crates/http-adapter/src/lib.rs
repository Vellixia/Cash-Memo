//! Axum boundary and reviewed contract mapping.

pub mod auth;
pub mod contracts;
pub mod problem;
pub mod router;
pub mod routes;

pub use router::{AppState, build_router};
