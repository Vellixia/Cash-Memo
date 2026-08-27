use axum::{
    Json, Router,
    extract::{Extension, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{error::HttpError, http::RequestId};

use super::{
    AuthError, AuthService, AuthSession, SessionAccess,
    cookie::{clear_session_cookie, session_cookie},
};

pub fn router<S>(auth: AuthService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/register", post(register))
        .route("/verify-email", post(verify_email))
        .route("/verification/resend", post(resend_verification))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/sessions/current", get(current_session))
        .route("/sessions/revoke-all", post(revoke_all))
        .route("/password-reset/request", post(request_password_reset))
        .route("/password-reset/consume", post(consume_password_reset))
        .layer(Extension(auth))
}

#[derive(Deserialize)]
struct CredentialsRequest {
    email: String,
    password: String,
}
#[derive(Deserialize)]
struct EmailRequest {
    email: String,
}
#[derive(Deserialize)]
struct TokenRequest {
    token: String,
}
#[derive(Deserialize)]
struct ResetRequest {
    token: String,
    password: String,
}
#[derive(Serialize)]
struct Accepted {
    accepted: bool,
}
#[derive(Serialize)]
struct CurrentSession {
    user_id: uuid::Uuid,
    session_id: uuid::Uuid,
    access: super::SessionAccess,
}

async fn register(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    body: Result<Json<CredentialsRequest>, JsonRejection>,
) -> Result<Json<Accepted>, HttpError> {
    let body = auth_json(body, request_id.clone())?;
    auth.register(&body.email, &body.password)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn verify_email(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    body: Result<Json<TokenRequest>, JsonRejection>,
) -> Result<Json<Accepted>, HttpError> {
    let body = auth_json(body, request_id.clone())?;
    auth.verify_email(&body.token)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn resend_verification(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    body: Result<Json<EmailRequest>, JsonRejection>,
) -> Result<Json<Accepted>, HttpError> {
    let body = auth_json(body, request_id.clone())?;
    auth.resend_verification(&body.email)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn login(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    body: Result<Json<CredentialsRequest>, JsonRejection>,
) -> Result<Response, HttpError> {
    let body = auth_json(body, request_id.clone())?;
    let session = auth
        .login(&body.email, &body.password)
        .await
        .map_err(|error| map_error(error, request_id))?;
    let mut response = Json(CurrentSession {
        user_id: session.user_id,
        session_id: session.session_id,
        access: session.access,
    })
    .into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&session_cookie(&session.raw_token)).expect("token is header-safe"),
    );
    Ok(response)
}

async fn logout(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
) -> Result<Response, HttpError> {
    let token =
        cookie_token(&headers).ok_or_else(|| HttpError::unauthorized(request_id.clone()))?;
    auth.logout(token)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(cleared_cookie_response())
}

async fn current_session(
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<CurrentSession>, HttpError> {
    if session.access != SessionAccess::Full {
        return Err(HttpError::forbidden(request_id));
    }
    Ok(Json(CurrentSession {
        user_id: session.user_id,
        session_id: session.session_id,
        access: session.access,
    }))
}

async fn revoke_all(
    Extension(auth): Extension<AuthService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Response, HttpError> {
    if session.access != SessionAccess::Full {
        return Err(HttpError::forbidden(request_id));
    }
    auth.revoke_all(session.user_id)
        .await
        .map_err(|_| HttpError::unauthorized(request_id))?;
    Ok(cleared_cookie_response())
}

async fn request_password_reset(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    body: Result<Json<EmailRequest>, JsonRejection>,
) -> Result<Json<Accepted>, HttpError> {
    let body = auth_json(body, request_id.clone())?;
    auth.request_password_reset(&body.email)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn consume_password_reset(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    body: Result<Json<ResetRequest>, JsonRejection>,
) -> Result<Response, HttpError> {
    let body = auth_json(body, request_id.clone())?;
    auth.consume_password_reset(&body.token, &body.password)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(cleared_cookie_response())
}

fn cookie_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("__Host-cashmemo_session="))
}

fn cleared_cookie_response() -> Response {
    let mut response = Json(Accepted { accepted: true }).into_response();
    clear_session_cookie(&mut response);
    response
}

fn auth_json<T>(
    body: Result<Json<T>, JsonRejection>,
    request_id: RequestId,
) -> Result<T, HttpError> {
    body.map(|Json(body)| body)
        .map_err(|_| HttpError::validation(Default::default(), request_id))
}

fn map_error(error: AuthError, request_id: RequestId) -> HttpError {
    match error {
        AuthError::InvalidCredentials => HttpError::invalid_credentials(request_id),
        AuthError::EmailNotVerified => HttpError::email_not_verified(request_id),
        AuthError::AccountUnavailable => HttpError::account_unavailable(request_id),
        AuthError::InvalidToken => HttpError::invalid_token(request_id),
        AuthError::Unauthorized => HttpError::unauthorized(request_id),
        AuthError::Validation => HttpError::validation(Default::default(), request_id),
        AuthError::Persistence => HttpError::internal(request_id),
    }
}
