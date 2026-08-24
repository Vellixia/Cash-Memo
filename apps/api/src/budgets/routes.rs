use std::collections::BTreeMap;

use axum::{
    Json, Router,
    extract::{Extension, Path, Query},
    http::StatusCode,
    routing::get,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    auth::{AuthSession, SessionAccess},
    error::HttpError,
    http::RequestId,
};

use super::{Budget, BudgetError, BudgetService, BudgetSummary, NewBudget, UpdateBudget};

pub fn router<S>(service: BudgetService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/budgets", get(list_budgets).post(create_budget))
        .route(
            "/budgets/{budget_id}",
            axum::routing::patch(update_budget).delete(delete_budget),
        )
        .route("/reports/budget-summary", get(budget_summary))
        .layer(Extension(service))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateBudgetRequest {
    category_id: Uuid,
    currency: String,
    month: String,
    amount: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateBudgetRequest {
    category_id: Option<Uuid>,
    currency: Option<String>,
    month: Option<String>,
    amount: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MonthQuery {
    month: Option<String>,
}

async fn list_budgets(
    Extension(service): Extension<BudgetService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Query(query): Query<MonthQuery>,
) -> Result<Json<Vec<Budget>>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .list(user_id, query.month.as_deref())
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn create_budget(
    Extension(service): Extension<BudgetService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<CreateBudgetRequest>,
) -> Result<(StatusCode, Json<Budget>), HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .create(
            user_id,
            NewBudget {
                category_id: body.category_id,
                currency: body.currency,
                month: body.month,
                amount: body.amount,
            },
        )
        .await
        .map(|budget| (StatusCode::CREATED, Json(budget)))
        .map_err(|error| map_error(error, request_id))
}

async fn update_budget(
    Extension(service): Extension<BudgetService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(budget_id): Path<Uuid>,
    Json(body): Json<UpdateBudgetRequest>,
) -> Result<Json<Budget>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .update(
            user_id,
            budget_id,
            UpdateBudget {
                category_id: body.category_id,
                currency: body.currency,
                month: body.month,
                amount: body.amount,
            },
        )
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn delete_budget(
    Extension(service): Extension<BudgetService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(budget_id): Path<Uuid>,
) -> Result<StatusCode, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .delete(user_id, budget_id)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|error| map_error(error, request_id))
}

async fn budget_summary(
    Extension(service): Extension<BudgetService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Query(query): Query<MonthQuery>,
) -> Result<Json<BudgetSummary>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .summary_for_month(user_id, query.month.as_deref())
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

fn full_access_user_id(session: AuthSession, request_id: RequestId) -> Result<Uuid, HttpError> {
    if session.access == SessionAccess::Full {
        Ok(session.user_id)
    } else {
        Err(HttpError::forbidden(request_id))
    }
}

fn map_error(error: BudgetError, request_id: RequestId) -> HttpError {
    match error {
        BudgetError::NotFound => HttpError::not_found(request_id),
        BudgetError::Conflict => HttpError::conflict(request_id),
        BudgetError::InvalidMonth => validation("month", request_id),
        BudgetError::InvalidCurrency => validation("currency", request_id),
        BudgetError::InvalidAmount => validation("amount", request_id),
        BudgetError::ArchivedCategory => validation("category_id", request_id),
        BudgetError::NoChanges => HttpError::validation(BTreeMap::new(), request_id),
        BudgetError::Persistence => HttpError::internal(request_id),
    }
}

fn validation(field: &str, request_id: RequestId) -> HttpError {
    HttpError::validation(
        BTreeMap::from([(field.to_owned(), vec!["invalid".to_owned()])]),
        request_id,
    )
}
