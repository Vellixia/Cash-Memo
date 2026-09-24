use axum::{
    Router,
    extract::{FromRequestParts, State},
    http::{HeaderMap, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{Duration, Utc};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::LazyLock;
use uuid::Uuid;

use crate::{
    AppState,
    entities::{session, user},
    error::{AppError, Json, Result},
};

const COOKIE: &str = "session";
const SESSION_DAYS: i64 = 30;

/// Verified against when the email is unknown, so login takes the same time either way.
static DUMMY_HASH: LazyLock<String> =
    LazyLock::new(|| password_auth::generate_hash("not-a-real-password"));

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
}

#[derive(Deserialize)]
struct Credentials {
    email: String,
    password: String,
}

#[derive(Serialize)]
struct UserOut {
    id: Uuid,
    email: String,
}

/// Authenticated user id, resolved from the session cookie.
pub struct CurrentUser(pub Uuid);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self> {
        let token = session_token(&parts.headers).ok_or(AppError::Unauthorized)?;
        let s = session::Entity::find_by_id(hash(token))
            .one(&state.db)
            .await?
            .filter(|s| s.expires_at > Utc::now())
            .ok_or(AppError::Unauthorized)?;
        Ok(CurrentUser(s.user_id))
    }
}

async fn signup(State(st): State<AppState>, Json(c): Json<Credentials>) -> Result<Response> {
    let email = c.email.trim().to_lowercase();
    if !email.contains('@') || email.len() > 254 {
        return Err(AppError::BadRequest("invalid email"));
    }
    if c.password.len() < 8 || c.password.len() > 256 {
        return Err(AppError::BadRequest("password must be 8-256 characters"));
    }
    let password_hash = blocking(move || password_auth::generate_hash(c.password)).await?;
    let u = user::ActiveModel {
        id: Set(Uuid::new_v4()),
        email: Set(email),
        password_hash: Set(password_hash),
        created_at: Set(Utc::now()),
    }
    .insert(&st.db)
    .await
    .map_err(|e| match AppError::from(e) {
        AppError::Conflict(_) => AppError::Conflict("email already registered"),
        e => e,
    })?;
    start_session(&st, u).await
}

async fn login(State(st): State<AppState>, Json(c): Json<Credentials>) -> Result<Response> {
    let u = user::Entity::find()
        .filter(user::Column::Email.eq(c.email.trim().to_lowercase()))
        .one(&st.db)
        .await?;
    let hash = u
        .as_ref()
        .map_or_else(|| DUMMY_HASH.clone(), |u| u.password_hash.clone());
    let ok = blocking(move || password_auth::verify_password(c.password, &hash).is_ok()).await?;
    match u {
        Some(u) if ok => start_session(&st, u).await,
        _ => Err(AppError::Unauthorized),
    }
}

async fn logout(State(st): State<AppState>, headers: HeaderMap) -> Result<Response> {
    if let Some(token) = session_token(&headers) {
        session::Entity::delete_by_id(hash(token))
            .exec(&st.db)
            .await?;
    }
    let clear = format!("{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, clear)]).into_response())
}

async fn me(State(st): State<AppState>, CurrentUser(id): CurrentUser) -> Result<Json<UserOut>> {
    let u = user::Entity::find_by_id(id)
        .one(&st.db)
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(UserOut {
        id: u.id,
        email: u.email,
    }))
}

async fn start_session(st: &AppState, u: user::Model) -> Result<Response> {
    // ponytail: expired sessions are swept on each login; move to a periodic task if the table grows.
    session::Entity::delete_many()
        .filter(session::Column::ExpiresAt.lt(Utc::now()))
        .exec(&st.db)
        .await?;
    let token: String = rand::random::<[u8; 32]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    session::ActiveModel {
        token_hash: Set(hash(&token)),
        user_id: Set(u.id),
        expires_at: Set(Utc::now() + Duration::days(SESSION_DAYS)),
    }
    .insert(&st.db)
    .await?;
    let secure = if st.cookie_secure { "; Secure" } else { "" };
    let cookie = format!(
        "{COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}{secure}",
        SESSION_DAYS * 86400
    );
    let body = Json(UserOut {
        id: u.id,
        email: u.email,
    });
    Ok(([(header::SET_COOKIE, cookie)], body).into_response())
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|kv| kv.trim().strip_prefix("session="))
        .filter(|t| !t.is_empty())
}

fn hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Password hashing is CPU-bound; keep it off the async workers.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}
