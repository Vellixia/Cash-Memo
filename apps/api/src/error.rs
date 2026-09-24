use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sea_orm::{DbErr, SqlErr};

#[derive(Debug)]
pub enum AppError {
    BadRequest(&'static str),
    Unauthorized,
    NotFound,
    Conflict(&'static str),
    Internal(String),
}

impl From<DbErr> for AppError {
    fn from(e: DbErr) -> Self {
        match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => AppError::Conflict("already exists"),
            Some(SqlErr::ForeignKeyConstraintViolation(_)) => {
                AppError::BadRequest("invalid reference")
            }
            _ => AppError::Internal(e.to_string()),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found"),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m),
            AppError::Internal(e) => {
                tracing::error!("{e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            }
        };
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
