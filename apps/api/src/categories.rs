use axum::{Router, extract::State, http::StatusCode, routing::get};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder, Set,
};
use serde::Deserialize;

use crate::memos::present;
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::category,
    error::{AppError, Json, Path, Result},
    parse_direction,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/categories", get(list).post(create))
        .route(
            "/categories/{id}",
            axum::routing::patch(update).delete(remove),
        )
}

#[derive(Deserialize)]
struct UpdateIn {
    name: Option<String>,
    #[serde(default, deserialize_with = "present")]
    emoji: Option<Option<String>>,
}

#[derive(Deserialize)]
struct CategoryIn {
    name: String,
    direction: String,
    emoji: Option<String>,
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
    let name = valid_name(&input.name)?;
    let c = category::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(uid),
        name: Set(name),
        direction: Set(parse_direction(&input.direction)?),
        emoji: Set(valid_emoji(input.emoji)?),
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

async fn update(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateIn>,
) -> Result<Json<category::Model>> {
    let mut c = category::Entity::find_by_id(id)
        .filter(category::Column::UserId.eq(uid))
        .one(&st.db)
        .await?
        .ok_or(AppError::NotFound)?
        .into_active_model();
    if let Some(name) = input.name {
        c.name = Set(valid_name(&name)?);
    }
    if let Some(emoji) = input.emoji {
        c.emoji = Set(valid_emoji(emoji)?);
    }
    Ok(Json(c.update(&st.db).await?))
}

fn valid_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::BadRequest("name must be 1-100 characters"));
    }
    Ok(name.to_owned())
}

/// Blank means "no emoji"; otherwise a short string (one emoji can be several code points).
fn valid_emoji(emoji: Option<String>) -> Result<Option<String>> {
    match emoji.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(e) if e.chars().count() <= 8 => Ok(Some(e.to_owned())),
        Some(_) => Err(AppError::BadRequest("emoji must be at most 8 characters")),
    }
}
