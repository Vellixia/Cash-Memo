use axum::{
    extract::{
        FromRequest, FromRequestParts,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sea_orm::{DbErr, SqlErr};
use serde::Serialize;

#[derive(Debug)]
pub enum AppError {
    BadRequest(&'static str),
    /// Malformed request (bad JSON, query or path), with the extractor's message.
    Invalid(String),
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
            AppError::Invalid(m) => {
                return (
                    StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({ "error": m })),
                )
                    .into_response();
            }
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not found"),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m),
            AppError::Internal(e) => {
                tracing::error!("{e}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            }
        };
        (status, axum::Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

macro_rules! rejection {
    ($($t:ty),*) => {$(
        impl From<$t> for AppError {
            fn from(r: $t) -> Self {
                AppError::Invalid(r.body_text())
            }
        }
    )*};
}
rejection!(JsonRejection, QueryRejection, PathRejection);

// Extractors whose rejections use the `{ "error": ... }` shape instead of axum's plain text.

#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(AppError))]
pub struct Json<T>(pub T);

impl<T: Serialize> IntoResponse for Json<T> {
    fn into_response(self) -> Response {
        axum::Json(self.0).into_response()
    }
}

#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(AppError))]
pub struct Query<T>(pub T);

#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Path), rejection(AppError))]
pub struct Path<T>(pub T);
