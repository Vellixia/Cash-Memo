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

use super::{ArchiveResult, Category, CategoryError, CategoryService, NewCategory, UpdateCategory};

pub fn router<S>(service: CategoryService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/categories", get(list_categories).post(create_category))
        .route(
            "/categories/{category_id}",
            axum::routing::patch(update_category).delete(delete_category),
        )
        .route("/categories/{category_id}/archive", post(archive_category))
        .route("/categories/{category_id}/restore", post(restore_category))
        .layer(Extension(service))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateCategoryRequest {
    name: String,
    kind: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateCategoryRequest {
    name: Option<String>,
}

async fn list_categories(
    Extension(service): Extension<CategoryService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<Vec<Category>>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .list(user_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn create_category(
    Extension(service): Extension<CategoryService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<Category>), HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .create(
            user_id,
            NewCategory {
                name: body.name,
                kind: body.kind,
            },
        )
        .await
        .map(|category| (StatusCode::CREATED, Json(category)))
        .map_err(|error| map_error(error, request_id))
}

async fn update_category(
    Extension(service): Extension<CategoryService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(category_id): Path<Uuid>,
    Json(body): Json<UpdateCategoryRequest>,
) -> Result<Json<Category>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .update(user_id, category_id, UpdateCategory { name: body.name })
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn archive_category(
    Extension(service): Extension<CategoryService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(category_id): Path<Uuid>,
) -> Result<Json<ArchiveResult>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .archive(user_id, category_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn restore_category(
    Extension(service): Extension<CategoryService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(category_id): Path<Uuid>,
) -> Result<Json<Category>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .restore(user_id, category_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn delete_category(
    Extension(service): Extension<CategoryService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Path(category_id): Path<Uuid>,
) -> Result<StatusCode, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .delete(user_id, category_id)
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

fn map_error(error: CategoryError, request_id: RequestId) -> HttpError {
    match error {
        CategoryError::NotFound => HttpError::not_found(request_id),
        CategoryError::HasReferences | CategoryError::NameConflict => {
            HttpError::conflict(request_id)
        }
        CategoryError::InvalidName => validation("name", request_id),
        CategoryError::InvalidKind => validation("kind", request_id),
        CategoryError::NoChanges => HttpError::validation(BTreeMap::new(), request_id),
        CategoryError::Persistence => HttpError::internal(request_id),
    }
}

fn validation(field: &str, request_id: RequestId) -> HttpError {
    HttpError::validation(
        BTreeMap::from([(field.to_owned(), vec!["invalid".to_owned()])]),
        request_id,
    )
}
