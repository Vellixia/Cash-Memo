use std::collections::BTreeMap;

use axum::{
    Json, Router,
    extract::{Extension, Query},
    routing::get,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::{AuthSession, SessionAccess},
    error::HttpError,
    http::RequestId,
};

use super::query::{MonthlySummary, RecentTransactions, ReportingError, ReportingQueries};

pub fn router<S>(queries: ReportingQueries) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/reports/monthly-summary", get(monthly_summary))
        .route("/transactions/recent", get(recent_transactions))
        .layer(Extension(queries))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MonthQuery {
    month: Option<String>,
}

async fn monthly_summary(
    Extension(queries): Extension<ReportingQueries>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Query(query): Query<MonthQuery>,
) -> Result<Json<MonthlySummary>, HttpError> {
    queries
        .monthly_summary(
            full_access_user_id(session, request_id.clone())?,
            query.month.as_deref(),
        )
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn recent_transactions(
    Extension(queries): Extension<ReportingQueries>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Query(query): Query<MonthQuery>,
) -> Result<Json<RecentTransactions>, HttpError> {
    queries
        .recent_transactions(
            full_access_user_id(session, request_id.clone())?,
            query.month.as_deref(),
        )
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

fn full_access_user_id(session: AuthSession, request_id: RequestId) -> Result<Uuid, HttpError> {
    (session.access == SessionAccess::Full)
        .then_some(session.user_id)
        .ok_or_else(|| HttpError::forbidden(request_id))
}

fn map_error(error: ReportingError, request_id: RequestId) -> HttpError {
    match error {
        ReportingError::InvalidMonth => HttpError::validation(
            BTreeMap::from([("month".to_owned(), vec!["invalid".to_owned()])]),
            request_id,
        ),
        ReportingError::Persistence => HttpError::internal(request_id),
    }
}
