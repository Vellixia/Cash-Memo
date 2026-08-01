//! Cashmemo modular-monolith process entry point.

use std::env;
use std::sync::Arc;

use cashmemo_application::clock::SystemClock;
use cashmemo_application::keyring::KekKeyring;
use cashmemo_application::use_cases::create_money_memo::CreateMoneyMemoService;
use cashmemo_application::use_cases::query_label_references::OwnerScopedLabelReferenceQuery;
use cashmemo_appwrite_adapter::{
    AppwriteClient, AppwriteConfig, AppwriteSessionValidator, CreateMoneyMemoStore, LabelStore,
};
use cashmemo_http_adapter::{AppState, build_router};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = AppwriteConfig {
        endpoint: required("APPWRITE_ENDPOINT")?,
        project_id: required("APPWRITE_PROJECT_ID")?,
        api_key: required("APPWRITE_SERVER_API_KEY")?,
        database_id: required("APPWRITE_DATABASE_ID")?,
    };
    let appwrite = AppwriteClient::new(config)?;
    let validator = Arc::new(AppwriteSessionValidator::new(appwrite.clone()));
    let label_query = Arc::new(OwnerScopedLabelReferenceQuery::new(
        Arc::new(LabelStore::new(appwrite.clone())),
        Arc::new(SystemClock),
    ));
    let creator = Arc::new(CreateMoneyMemoService::new(
        Arc::new(CreateMoneyMemoStore::new(appwrite)),
        Arc::new(KekKeyring::from_environment()?),
        Arc::new(SystemClock),
    ));
    let app = build_router(
        AppState::new(validator)
            .with_label_references(label_query)
            .with_money_memo_creator(creator),
    );
    let bind = env::var("CASHMEMO_HTTP_BIND").unwrap_or_else(|_| "0.0.0.0:3001".to_owned());
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn required(name: &'static str) -> Result<String, &'static str> {
    env::var(name).map_err(|_| "required runtime configuration missing")
}
