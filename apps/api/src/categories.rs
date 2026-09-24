use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::category,
    error::{AppError, Result},
    parse_direction,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/categories", get(list).post(create))
        .route("/categories/{id}", delete(remove))
}

#[derive(Deserialize)]
struct CategoryIn {
    name: String,
    direction: String,
}

async fn list(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
) -> Result<Json<Vec<category::Model>>> {
    let all = category::Entity::find()
        .filter(category::Column::UserId.eq(uid))
        .order_by_asc(category::Column::Direction)
        .order_by_asc(category::Column::Name)
        .all(&st.db)
        .await?;
    Ok(Json(all))
}

async fn create(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<CategoryIn>,
) -> Result<(StatusCode, Json<category::Model>)> {
    let name = input.name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::BadRequest("name must be 1-100 characters"));
    }
    let c = category::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(uid),
        name: Set(name),
        direction: Set(parse_direction(&input.direction)?),
    }
    .insert(&st.db)
    .await?;
    Ok((StatusCode::CREATED, Json(c)))
}

async fn remove(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    let res = category::Entity::delete_many()
        .filter(category::Column::Id.eq(id))
        .filter(category::Column::UserId.eq(uid))
        .exec(&st.db)
        .await?;
    if res.rows_affected == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
