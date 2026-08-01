//! Axum router shell with fail-closed auth and no-store responses.

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Router, extract::Request};
use cashmemo_application::authorization::SessionValidator;
use cashmemo_application::use_cases::create_money_memo::CreateMoneyMemo;
use cashmemo_application::use_cases::query_label_references::LabelReferenceQuery;

use crate::routes::create_money_memo::create_money_memo;
use crate::routes::currencies::currencies;
use crate::routes::label_reference::query_labels;

/// Shared HTTP state. It stores capabilities, never an authenticated owner.
#[derive(Clone)]
pub struct AppState {
    session_validator: Arc<dyn SessionValidator>,
    label_references: Option<Arc<dyn LabelReferenceQuery>>,
    money_memo_creator: Option<Arc<dyn CreateMoneyMemo>>,
}

impl AppState {
    /// Creates router state with a live session validator.
    #[must_use]
    pub fn new(session_validator: Arc<dyn SessionValidator>) -> Self {
        Self {
            session_validator,
            label_references: None,
            money_memo_creator: None,
        }
    }

    /// Adds the owner-scoped label reference capability.
    #[must_use]
    pub fn with_label_references(mut self, query: Arc<dyn LabelReferenceQuery>) -> Self {
        self.label_references = Some(query);
        self
    }

    pub(crate) fn session_validator(&self) -> &dyn SessionValidator {
        self.session_validator.as_ref()
    }

    pub(crate) fn label_references(&self) -> Option<&dyn LabelReferenceQuery> {
        self.label_references.as_deref()
    }

    /// Adds the create use-case capability.
    #[must_use]
    pub fn with_money_memo_creator(mut self, creator: Arc<dyn CreateMoneyMemo>) -> Self {
        self.money_memo_creator = Some(creator);
        self
    }

    pub(crate) fn money_memo_creator(&self) -> Option<&dyn CreateMoneyMemo> {
        self.money_memo_creator.as_deref()
    }
}

/// Builds the protected Feature 001 API shell.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/reference/currencies", get(currencies))
        .route("/api/v1/labels/query", axum::routing::post(query_labels))
        .route("/api/v1/money-memos", post(create_money_memo))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn(no_store))
        .with_state(state)
}

async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
