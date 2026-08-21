use axum::{
    Json, Router,
    extract::{Extension, State},
    http::StatusCode,
    middleware,
    routing::get,
};
use sqlx::PgPool;

use crate::{
    auth::{AuthConfig, AuthService, SmtpEmailSender, UnconfiguredEmailSender, routes},
    budgets::{BudgetService, router as budget_routes},
    categories::{CategoryService, router as category_routes},
    config::{AppConfig, HttpSafetyConfig},
    currency::{CurrencyRepository, EnabledCurrencyResponse},
    error::HttpError,
    http::{
        RequestId,
        cache::no_store,
        origin::{OriginPolicy, enforce_exact_origin},
        rate_limit::{AuthRateLimiter, enforce_auth_limit},
        request_id::attach,
    },
    onboarding::{OnboardingService, routes as onboarding_routes},
    recurring::{RecurringTransactionService, router as recurring_routes},
    reporting::{ReportingQueries, router as reporting_routes},
    transactions::{TransactionService, router as transaction_routes},
    wallets::{WalletService, routes as wallet_routes},
};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
}

pub fn build_app(state: AppState) -> Router {
    let auth = AuthService::new(
        state.pool.clone(),
        std::sync::Arc::new(UnconfiguredEmailSender),
        AuthConfig::default(),
    );
    build_app_with_safety(state, HttpSafetyConfig::default(), auth)
}

pub fn build_app_with_config(state: AppState, config: &AppConfig) -> Router {
    let mailer = SmtpEmailSender::new(&config.smtp).expect("validated SMTP configuration");
    let auth = AuthService::new(
        state.pool.clone(),
        std::sync::Arc::new(mailer),
        config.auth.clone(),
    );
    build_app_with_safety(state, config.http_safety.clone(), auth)
}

fn build_app_with_safety(state: AppState, config: HttpSafetyConfig, auth: AuthService) -> Router {
    let onboarding = OnboardingService::new(state.pool.clone());
    let wallets = WalletService::new(state.pool.clone());
    let categories = CategoryService::new(state.pool.clone());
    let budgets = BudgetService::new(state.pool.clone());
    let transactions = TransactionService::new(state.pool.clone());
    let recurring = RecurringTransactionService::new(state.pool.clone());
    let reporting = ReportingQueries::new(state.pool.clone());
    Router::<AppState>::new()
        .nest("/api/v1/auth", routes::router(auth.clone()))
        .nest(
            "/api/v1",
            onboarding_routes::router(onboarding)
                .merge(wallet_routes::router(wallets))
                .merge(category_routes(categories))
                .merge(budget_routes(budgets))
                .merge(transaction_routes(transactions))
                .merge(recurring_routes(recurring))
                .merge(reporting_routes(reporting))
                .layer(Extension(auth)),
        )
        .route("/api/v1/currencies", get(list_currencies))
        .route("/api/v1/health/live", get(health_live))
        .route("/api/v1/health/ready", get(health_ready))
        .fallback(not_found)
        .with_state(state)
        .layer(middleware::from_fn_with_state(
            AuthRateLimiter::new(config.auth_rate_limits),
            enforce_auth_limit,
        ))
        .layer(middleware::from_fn(no_store))
        .layer(middleware::from_fn_with_state(
            OriginPolicy::new(config.allowed_origins),
            enforce_exact_origin,
        ))
        .layer(middleware::from_fn(attach))
}

async fn list_currencies(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Json<Vec<EnabledCurrencyResponse>>, HttpError> {
    CurrencyRepository::enabled(&state.pool)
        .await
        .map(|currencies| Json(currencies.into_iter().map(Into::into).collect()))
        .map_err(|_| HttpError::internal(request_id))
}

async fn health_live() -> StatusCode {
    StatusCode::OK
}

async fn health_ready(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
) -> Result<StatusCode, HttpError> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .map(|_| StatusCode::OK)
        .map_err(|_| HttpError::unavailable(request_id))
}

async fn not_found(Extension(request_id): Extension<RequestId>) -> HttpError {
    HttpError::not_found(request_id)
}
