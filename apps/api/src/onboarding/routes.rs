use std::collections::BTreeMap;

use axum::{
    Json, Router,
    extract::Extension,
    routing::{get, post, put},
};
use serde::Deserialize;

use crate::{
    auth::{AuthSession, SessionAccess},
    error::HttpError,
    http::RequestId,
};

use super::{OnboardingError, OnboardingService, OnboardingState, Preferences};

pub fn router<S>(service: OnboardingService) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/onboarding", get(onboarding))
        .route("/onboarding/seed-categories", post(seed_categories))
        .route("/settings/preferences", put(update_preferences))
        .layer(Extension(service))
}

#[derive(Deserialize)]
struct PreferencesRequest {
    timezone: String,
    default_currency_code: String,
}

async fn onboarding(
    Extension(service): Extension<OnboardingService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<OnboardingState>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .state(user_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn update_preferences(
    Extension(service): Extension<OnboardingService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<PreferencesRequest>,
) -> Result<Json<OnboardingState>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .update_preferences(
            user_id,
            Preferences {
                timezone: body.timezone,
                default_currency_code: body.default_currency_code,
            },
        )
        .await
        .map_err(|error| map_error(error, request_id.clone()))?;
    service
        .state(user_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

async fn seed_categories(
    Extension(service): Extension<OnboardingService>,
    session: AuthSession,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<OnboardingState>, HttpError> {
    let user_id = full_access_user_id(session, request_id.clone())?;
    service
        .seed_categories(user_id)
        .await
        .map_err(|error| map_error(error, request_id.clone()))?;
    service
        .state(user_id)
        .await
        .map(Json)
        .map_err(|error| map_error(error, request_id))
}

fn full_access_user_id(
    session: AuthSession,
    request_id: RequestId,
) -> Result<uuid::Uuid, HttpError> {
    if session.access == SessionAccess::Full {
        Ok(session.user_id)
    } else {
        Err(HttpError::forbidden(request_id))
    }
}

fn map_error(error: OnboardingError, request_id: RequestId) -> HttpError {
    match error {
        OnboardingError::InvalidTimezone => validation("timezone", request_id),
        OnboardingError::UnsupportedCurrency => validation("default_currency_code", request_id),
        OnboardingError::Persistence => HttpError::internal(request_id),
    }
}

fn validation(field: &str, request_id: RequestId) -> HttpError {
    HttpError::validation(
        BTreeMap::from([(field.to_owned(), vec!["invalid".to_owned()])]),
        request_id,
    )
}
