use api::{AppState, app};
use domain::migration::{Migrator, MigratorTrait};

fn main() {
    dotenvy::dotenv().ok();
    let _telemetry = telemetry::init(sentry::release_name!());

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(run());
}

async fn run() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    let mut opts = sea_orm::ConnectOptions::new(url);
    opts.max_connections(20)
        .min_connections(2)
        .sqlx_logging(false);
    let db = sea_orm::Database::connect(opts).await.expect("connect db");
    Migrator::up(&db, None).await.expect("run migrations");

    let state = AppState {
        db,
        cookie_secure: std::env::var("COOKIE_SECURE").is_ok_and(|v| v == "true"),
        limiter: Default::default(),
        app_url: std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".into()),
    };
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("bind");
    tracing::info!("listening on {port}");
    let app = app(state)
        .layer(sentry::integrations::tower::SentryHttpLayer::new())
        .layer(sentry::integrations::tower::NewSentryLayer::new_from_top());
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await
        .expect("serve");
}

/// Finish in-flight requests on SIGTERM (container stop) or Ctrl-C.
async fn shutdown() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.expect("ctrl-c handler") };
    #[cfg(unix)]
    let term = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("sigterm handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutting down");
}
