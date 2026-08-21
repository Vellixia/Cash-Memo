use axum::{
    Json, Router,
    extract::Extension,
    http::{HeaderMap, HeaderValue, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{error::HttpError, http::RequestId};

use super::{AuthError, AuthService, AuthSession};

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
    Json(body): Json<CredentialsRequest>,
) -> Result<Json<Accepted>, HttpError> {
    auth.register(&body.email, &body.password)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn verify_email(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<TokenRequest>,
) -> Result<Json<Accepted>, HttpError> {
    auth.verify_email(&body.token)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn resend_verification(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<EmailRequest>,
) -> Result<Json<Accepted>, HttpError> {
    auth.resend_verification(&body.email)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn login(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<CredentialsRequest>,
) -> Result<Response, HttpError> {
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
    Ok(clear_cookie())
}

async fn current_session(session: AuthSession) -> Json<CurrentSession> {
    Json(CurrentSession {
        user_id: session.user_id,
        session_id: session.session_id,
        access: session.access,
    })
}

async fn revoke_all(
    Extension(auth): Extension<AuthService>,
    session: AuthSession,
) -> Result<Response, HttpError> {
    auth.revoke_all(session.user_id)
        .await
        .map_err(|_| HttpError::unauthorized(RequestId::new()))?;
    Ok(clear_cookie())
}

async fn request_password_reset(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<EmailRequest>,
) -> Result<Json<Accepted>, HttpError> {
    auth.request_password_reset(&body.email)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(Accepted { accepted: true }))
}

async fn consume_password_reset(
    Extension(auth): Extension<AuthService>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<ResetRequest>,
) -> Result<Response, HttpError> {
    auth.consume_password_reset(&body.token, &body.password)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(clear_cookie())
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

fn session_cookie(token: &str) -> String {
    format!("__Host-cashmemo_session={token}; Path=/; Secure; HttpOnly; SameSite=Lax")
}

fn clear_cookie() -> Response {
    let mut response = Json(Accepted { accepted: true }).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "__Host-cashmemo_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
        ),
    );
    response
}

fn map_error(error: AuthError, request_id: RequestId) -> HttpError {
    match error {
        AuthError::InvalidCredentials => HttpError::invalid_credentials(request_id),
        AuthError::EmailNotVerified => HttpError::email_not_verified(request_id),
        AuthError::AccountUnavailable => HttpError::account_unavailable(request_id),
        AuthError::InvalidToken => HttpError::invalid_token(request_id),
        AuthError::Unauthorized => HttpError::unauthorized(request_id),
        AuthError::Validation => HttpError::validation(Default::default(), request_id),
        AuthError::EmailDelivery | AuthError::Persistence => HttpError::internal(request_id),
    }
}
