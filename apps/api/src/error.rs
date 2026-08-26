use std::collections::BTreeMap;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

use crate::{config::ConfigError, db::target_guard::TargetError, http::RequestId};

pub type ErrorFields = BTreeMap<String, Vec<String>>;

#[derive(Debug)]
pub struct HttpError {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
    fields: Option<ErrorFields>,
    request_id: RequestId,
}

#[derive(Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<ErrorFields>,
    request_id: String,
}

impl HttpError {
    pub fn unauthorized(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Authentication required.",
            request_id,
        )
    }

    pub fn invalid_credentials(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
            request_id,
        )
    }

    pub fn email_not_verified(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "EMAIL_NOT_VERIFIED",
            "Email verification is required.",
            request_id,
        )
    }

    pub fn account_unavailable(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "ACCOUNT_UNAVAILABLE",
            "Account is unavailable.",
            request_id,
        )
    }

    pub fn invalid_token(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "INVALID_TOKEN",
            "Token is invalid or expired.",
            request_id,
        )
    }

    pub fn forbidden(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Request is not allowed.",
            request_id,
        )
    }

    pub fn not_found(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "Resource not found.",
            request_id,
        )
    }

    pub fn validation(fields: ErrorFields, request_id: RequestId) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "VALIDATION_FAILED",
            message: "Check the highlighted fields.",
            fields: Some(fields),
            request_id,
        }
    }

    pub fn conflict(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "CONFLICT",
            "Request conflicts with current state.",
            request_id,
        )
    }

    pub fn throttled(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "Too many requests.",
            request_id,
        )
    }

    pub fn invalid_forwarding(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "INVALID_FORWARDING_METADATA",
            "Forwarding metadata is invalid.",
            request_id,
        )
    }

    pub fn unavailable(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "Service unavailable.",
            request_id,
        )
    }

    pub fn internal(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_SERVER_ERROR",
            "Internal server error.",
            request_id,
        )
    }

    fn new(
        status: StatusCode,
        code: &'static str,
        message: &'static str,
        request_id: RequestId,
    ) -> Self {
        Self {
            status,
            code,
            message,
            fields: None,
            request_id,
        }
    }
}

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorEnvelope {
                error: ErrorBody {
                    code: self.code,
                    message: self.message,
                    fields: self.fields,
                    request_id: self.request_id.as_str().to_owned(),
                },
            }),
        )
            .into_response()
    }
}

#[derive(Debug, Error)]
pub enum ApiError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Target(#[from] TargetError),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("auth token cleanup failed")]
    AuthCleanup,
    #[error("trash purge failed")]
    TrashPurge,
    #[error("recurring processing failed")]
    RecurringProcess,
    #[error("account purge failed")]
    AccountPurge,
    #[error("receipt replay is not ready for restored database traffic")]
    ReceiptReplayNotReady,
    #[error("receipt replay requires isolated restored database acknowledgement")]
    ReceiptReplayIsolation,
    #[error(transparent)]
    Server(#[from] std::io::Error),
}
