//! One optional receipt/photo per memo. Only presigned URLs cross the API for the bytes
//! themselves (see crates/domain/src/storage.rs); the API's only direct HTTP call is the HEAD
//! that confirms an upload landed, and the DELETE that removes a replaced/removed one.
use std::time::Duration;

use axum::{Router, extract::State, http::StatusCode, routing::post};
use domain::storage::{Storage, attachment_prefix};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::memo,
    error::{AppError, Json, Path, Result},
};

const MAX_BYTES: u64 = 5 * 1024 * 1024;
const PUT_TTL: Duration = Duration::from_secs(300);
const GET_TTL: Duration = Duration::from_secs(300);
const HEAD_TTL: Duration = Duration::from_secs(60);
const DELETE_TTL: Duration = Duration::from_secs(60);

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/memos/{id}/attachment",
        post(start).put(confirm).get(view).delete(remove),
    )
}

fn storage(st: &AppState) -> Result<&Storage> {
    st.storage
        .as_deref()
        .ok_or(AppError::Unavailable("file storage isn't configured"))
}

async fn owned(st: &AppState, uid: Uuid, id: Uuid) -> Result<memo::Model> {
    memo::Entity::find_by_id(id)
        .filter(memo::Column::UserId.eq(uid))
        .filter(memo::Column::DeletedAt.is_null())
        .one(&st.db)
        .await?
        .ok_or(AppError::NotFound)
}

#[derive(Deserialize)]
struct StartIn {
    /// Only these two are accepted; the client downscales/re-encodes to one of them before upload.
    content_type: String,
}

#[derive(Serialize)]
struct StartOut {
    /// PUT the image bytes here (valid 5 minutes) with a `Content-Type` header matching exactly
    /// what was requested — the URL is signed for that header, so a mismatched PUT is rejected.
    upload_url: String,
    key: String,
}

async fn start(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(memo_id): Path<Uuid>,
    Json(input): Json<StartIn>,
) -> Result<Json<StartOut>> {
    let storage = storage(&st)?;
    owned(&st, uid, memo_id).await?;
    let ext = match input.content_type.as_str() {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => {
            return Err(AppError::BadRequest(
                "content type must be image/jpeg or image/webp",
            ));
        }
    };
    let key = format!(
        "{}{memo_id}/{}.{ext}",
        attachment_prefix(uid),
        Uuid::new_v4()
    );
    Ok(Json(StartOut {
        upload_url: storage.put_url_typed(&key, &input.content_type, PUT_TTL),
        key,
    }))
}

#[derive(Deserialize)]
struct ConfirmIn {
    key: String,
}

#[derive(Serialize)]
struct AttachmentOut {
    has_attachment: bool,
}

/// Confirms the upload landed (HEAD), checks its size, then swaps it onto the memo, deleting
/// whatever attachment was there before.
async fn confirm(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(memo_id): Path<Uuid>,
    Json(input): Json<ConfirmIn>,
) -> Result<Json<AttachmentOut>> {
    let storage = storage(&st)?;
    let m = owned(&st, uid, memo_id).await?;
    let prefix = format!("{}{memo_id}/", attachment_prefix(uid));
    // Exactly `<prefix><uuid>.<jpg|webp>`: a looser check (e.g. `starts_with`) would let `../` segments,
    // which URL parsing normalizes, point the presigned URLs at another user's object.
    let valid = input.key.strip_prefix(&prefix).is_some_and(|name| {
        name.rsplit_once('.')
            .is_some_and(|(id, ext)| Uuid::parse_str(id).is_ok() && matches!(ext, "jpg" | "webp"))
    });
    if !valid {
        return Err(AppError::BadRequest(
            "that upload doesn't belong to this memo",
        ));
    }
    let head = st
        .http
        .head(storage.head_url(&input.key, HEAD_TTL))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("check attachment: {e}")))?;
    if head.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::BadRequest("upload the image first"));
    }
    if !head.status().is_success() {
        return Err(AppError::Internal(format!(
            "check attachment: {}",
            head.status()
        )));
    }
    let size: u64 = head
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if size == 0 || size > MAX_BYTES {
        delete_object(&st, &input.key).await?;
        return Err(AppError::BadRequest("image must be 5 MB or smaller"));
    }

    let previous = m.attachment_key.clone();
    let mut active = m.into_active_model();
    active.attachment_key = Set(Some(input.key.clone()));
    active.update(&st.db).await?;

    if let Some(old) = previous.filter(|k| *k != input.key) {
        delete_object(&st, &old).await?;
    }
    Ok(Json(AttachmentOut {
        has_attachment: true,
    }))
}

#[derive(Serialize)]
struct ViewOut {
    /// Presigned GET, valid 5 minutes, rendered inline (no forced download).
    url: String,
}

async fn view(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(memo_id): Path<Uuid>,
) -> Result<Json<ViewOut>> {
    let storage = storage(&st)?;
    let m = owned(&st, uid, memo_id).await?;
    let key = m.attachment_key.ok_or(AppError::NotFound)?;
    Ok(Json(ViewOut {
        url: storage.get_inline_url(&key, GET_TTL),
    }))
}

async fn remove(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(memo_id): Path<Uuid>,
) -> Result<StatusCode> {
    storage(&st)?;
    let m = owned(&st, uid, memo_id).await?;
    let Some(key) = m.attachment_key.clone() else {
        return Ok(StatusCode::NO_CONTENT);
    };
    let mut active = m.into_active_model();
    active.attachment_key = Set(None);
    active.update(&st.db).await?;
    delete_object(&st, &key).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Best-effort delete: an object already gone (404) isn't an error.
async fn delete_object(st: &AppState, key: &str) -> Result<()> {
    let storage = storage(st)?;
    let res = st
        .http
        .delete(storage.delete_url(key, DELETE_TTL))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("delete attachment: {e}")))?;
    if !res.status().is_success() && res.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::Internal(format!(
            "delete attachment: {}",
            res.status()
        )));
    }
    Ok(())
}
