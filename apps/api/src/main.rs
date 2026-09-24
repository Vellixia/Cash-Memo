use api::{AppState, app};
use migration::{Migrator, MigratorTrait};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();

    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    let db = sea_orm::Database::connect(&url).await.expect("connect db");
    Migrator::up(&db, None).await.expect("run migrations");

    let state = AppState {
        db,
        cookie_secure: std::env::var("COOKIE_SECURE").is_ok_and(|v| v == "true"),
    };
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("bind");
    tracing::info!("listening on {port}");
    axum::serve(listener, app(state)).await.expect("serve");
}
