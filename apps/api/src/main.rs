use api::{AppState, app};
use domain::migration::{Migrator, MigratorTrait};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

fn main() {
    dotenvy::dotenv().ok();
    // Error tracking (GlitchTip, Sentry-compatible). A no-op when SENTRY_DSN is unset.
    let mut sentry_opts = sentry::ClientOptions::new()
        .maybe_release(sentry::release_name!())
        .send_default_pii(false)
        // Money data never leaves the server: keep only method + path of the request.
        .before_send(|mut event| {
            if let Some(req) = event.request.as_mut() {
                req.data = None;
                req.query_string = None;
                req.cookies = None;
                req.headers.clear();
                req.env.clear();
            }
            Some(event)
        });
    if let Ok(dsn) = std::env::var("SENTRY_DSN") {
        sentry_opts = sentry_opts.dsn(&dsn);
    }
    if let Ok(env) = std::env::var("SENTRY_ENVIRONMENT") {
        sentry_opts = sentry_opts.environment(env);
    }
    let _sentry = sentry::init(sentry_opts);
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,sqlx=warn".into()))
        .with(tracing_subscriber::fmt::layer())
        .with(sentry::integrations::tracing::layer())
        .init();

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
