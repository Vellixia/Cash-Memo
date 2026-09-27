//! Account management that goes through email: password reset, change password/email, delete.
use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{Duration, Utc};
use domain::jobs;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, PaginatorTrait,
    QueryFilter, Set, TransactionTrait,
};
use serde::Deserialize;
use std::time::Duration as Window;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{
        COOKIE, CurrentUser, UserOut, blocking, hash, random_token, session_token, valid_email,
        valid_password,
    },
    entities::{email_token, session, user},
    error::{AppError, Json, Result},
    limits::client_ip,
};

const LINK_HOURS: i64 = 1;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/password-reset/request", post(reset_request))
        .route("/auth/password-reset/complete", post(reset_complete))
        .route("/auth/password", post(change_password))
        .route("/auth/email", post(change_email))
        .route("/auth/email/confirm", post(confirm_email))
        .route("/auth/delete", post(delete_account))
}

#[derive(Deserialize)]
struct EmailIn {
    email: String,
}

#[derive(Deserialize)]
struct CompleteIn {
    token: String,
    password: String,
}

#[derive(Deserialize)]
struct ChangePasswordIn {
    current_password: String,
    new_password: String,
}

#[derive(Deserialize)]
struct ChangeEmailIn {
    current_password: String,
    new_email: String,
}

#[derive(Deserialize)]
struct TokenIn {
    token: String,
}

#[derive(Deserialize)]
struct PasswordIn {
    password: String,
}

/// Always 204, whether or not the email has an account.
async fn reset_request(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<EmailIn>,
) -> Result<StatusCode> {
    st.limiter.check(
        format!("reset:{}", client_ip(&headers)),
        3,
        Window::from_secs(60),
    )?;
    let email = input.email.trim().to_lowercase();
    let Some(u) = user::Entity::find()
        .filter(user::Column::Email.eq(email))
        .one(&st.db)
        .await?
    else {
        return Ok(StatusCode::NO_CONTENT);
    };
    // Per address: silently drop extra requests, so nobody can flood a stranger's inbox.
    if !within_mail_limits(&st.db, u.id).await? {
        return Ok(StatusCode::NO_CONTENT);
    }
    let token = issue_token(&st.db, u.id, "reset", None).await?;
    let link = format!("{}/reset?token={token}", st.app_url);
    let mail = jobs::Email {
        to: u.email,
        subject: "Reset your Cash Memo password".into(),
        text: format!(
            "Someone asked to reset the Cash Memo password for this email.\n\n\
             Choose a new password here (the link works once, for {LINK_HOURS} hour):\n{link}\n\n\
             If it wasn't you, ignore this email. Your password stays the same."
        ),
    };
    jobs::enqueue(&st.db, jobs::EMAIL, mail, Some(u.id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Sets the new password and signs out every session.
async fn reset_complete(
    State(st): State<AppState>,
    Json(input): Json<CompleteIn>,
) -> Result<StatusCode> {
    valid_password(&input.password)?;
    let txn = st.db.begin().await?;
    let t = use_token(&txn, &input.token, "reset").await?;
    let password_hash = blocking(move || password_auth::generate_hash(input.password)).await?;
    let mut u = find_user(&txn, t.user_id).await?.into_active_model();
    u.password_hash = Set(password_hash);
    u.update(&txn).await?;
    session::Entity::delete_many()
        .filter(session::Column::UserId.eq(t.user_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Needs the current password; keeps this session, signs out the others.
async fn change_password(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    headers: HeaderMap,
    Json(input): Json<ChangePasswordIn>,
) -> Result<StatusCode> {
    valid_password(&input.new_password)?;
    let u = find_user(&st.db, uid).await?;
    check_password(&st, &u, input.current_password).await?;
    let password_hash = blocking(move || password_auth::generate_hash(input.new_password)).await?;
    let current = session_token(&headers).map(hash).unwrap_or_default();
    let txn = st.db.begin().await?;
    let mut u = u.into_active_model();
    u.password_hash = Set(password_hash);
    u.update(&txn).await?;
    session::Entity::delete_many()
        .filter(session::Column::UserId.eq(uid))
        .filter(session::Column::TokenHash.ne(current))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Sends a confirm link to the new address; the email changes only once it's opened.
async fn change_email(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<ChangeEmailIn>,
) -> Result<StatusCode> {
    let new_email = valid_email(&input.new_email)?;
    let u = find_user(&st.db, uid).await?;
    check_password(&st, &u, input.current_password).await?;
    if new_email == u.email {
        return Err(AppError::BadRequest("that is already your email"));
    }
    let taken = user::Entity::find()
        .filter(user::Column::Email.eq(new_email.as_str()))
        .count(&st.db)
        .await?;
    if taken > 0 {
        return Err(AppError::Conflict("email already registered"));
    }
    if !within_mail_limits(&st.db, uid).await? {
        return Err(AppError::TooManyRequests);
    }
    let token = issue_token(&st.db, uid, "change_email", Some(new_email.clone())).await?;
    let link = format!("{}/confirm-email?token={token}", st.app_url);
    let mail = jobs::Email {
        to: new_email,
        subject: "Confirm your new Cash Memo email".into(),
        text: format!(
            "Confirm this address for your Cash Memo account (the link works once, for {LINK_HOURS} hour):\n{link}\n\n\
             If you didn't ask for this, ignore this email."
        ),
    };
    jobs::enqueue(&st.db, jobs::EMAIL, mail, Some(uid)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn confirm_email(
    State(st): State<AppState>,
    Json(input): Json<TokenIn>,
) -> Result<Json<UserOut>> {
    let txn = st.db.begin().await?;
    let t = use_token(&txn, &input.token, "change_email").await?;
    let mut u = find_user(&txn, t.user_id).await?.into_active_model();
    u.email = Set(t
        .new_email
        .ok_or(AppError::BadRequest("invalid or expired link"))?);
    let u = u.update(&txn).await.map_err(|e| match AppError::from(e) {
        AppError::Conflict(_) => AppError::Conflict("email already registered"),
        e => e,
    })?;
    txn.commit().await?;
    Ok(Json(u.into()))
}

/// Hard-deletes the account and everything in it (the schema cascades from users).
async fn delete_account(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<PasswordIn>,
) -> Result<Response> {
    let u = find_user(&st.db, uid).await?;
    check_password(&st, &u, input.password).await?;
    let txn = st.db.begin().await?;
    if st.storage.is_some() {
        // Not tied to the user row, so it survives the cascade below.
        let prefix = domain::storage::user_prefix(uid);
        jobs::enqueue(&txn, jobs::PURGE_FILES, jobs::PurgePayload { prefix }, None).await?;
    }
    user::Entity::delete_by_id(uid).exec(&txn).await?;
    txn.commit().await?;
    let clear = format!("{COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, clear)]).into_response())
}

async fn find_user(db: &impl ConnectionTrait, id: Uuid) -> Result<user::Model> {
    user::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or(AppError::Unauthorized)
}

/// Wrong current password is a 400 (not 401), so the client doesn't treat it as a lost session.
async fn check_password(st: &AppState, u: &user::Model, password: String) -> Result<()> {
    st.limiter.check(
        format!("password-check:{}", u.id),
        10,
        Window::from_secs(900),
    )?;
    let hash = u.password_hash.clone();
    let ok = blocking(move || password_auth::verify_password(password, &hash).is_ok()).await?;
    if !ok {
        return Err(AppError::BadRequest("current password is incorrect"));
    }
    Ok(())
}

/// At most one email per minute and five per day per account.
async fn within_mail_limits(db: &impl ConnectionTrait, uid: Uuid) -> Result<bool> {
    let since = |d: Duration| {
        email_token::Entity::find()
            .filter(email_token::Column::UserId.eq(uid))
            .filter(email_token::Column::CreatedAt.gt(Utc::now() - d))
            .count(db)
    };
    Ok(since(Duration::minutes(1)).await? == 0 && since(Duration::days(1)).await? < 5)
}

async fn issue_token(
    db: &impl ConnectionTrait,
    uid: Uuid,
    purpose: &str,
    new_email: Option<String>,
) -> Result<String> {
    let token = random_token();
    let now = Utc::now();
    email_token::ActiveModel {
        token_hash: Set(hash(&token)),
        user_id: Set(uid),
        purpose: Set(purpose.to_owned()),
        new_email: Set(new_email),
        expires_at: Set(now + Duration::hours(LINK_HOURS)),
        used_at: Set(None),
        created_at: Set(now),
    }
    .insert(db)
    .await?;
    Ok(token)
}

/// Marks a valid, unused, unexpired token as used and returns it.
async fn use_token(
    db: &impl ConnectionTrait,
    token: &str,
    purpose: &str,
) -> Result<email_token::Model> {
    let invalid = AppError::BadRequest("invalid or expired link");
    let t = email_token::Entity::find_by_id(hash(token.trim()))
        .one(db)
        .await?
        .filter(|t| t.purpose == purpose && t.used_at.is_none() && t.expires_at > Utc::now())
        .ok_or(invalid)?;
    let mut active = t.clone().into_active_model();
    active.used_at = Set(Some(Utc::now()));
    active.update(db).await?;
    Ok(t)
}
