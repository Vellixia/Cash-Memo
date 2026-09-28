//! Logging + error tracking shared by the Rust apps. Errors and logs go to GlitchTip
//! (Sentry-compatible) when SENTRY_DSN is set; otherwise only to stdout.
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

pub use sentry::ClientInitGuard;

/// The release version, baked in at build time from the git tag (`APP_VERSION`, set by the release
/// workflow); "dev" for local and CI builds.
pub const VERSION: &str = match option_env!("APP_VERSION") {
    Some(v) => v,
    None => "dev",
};

/// Call first in `main`, before the async runtime starts; keep the guard alive until exit.
pub fn init() -> ClientInitGuard {
    let mut opts = sentry::ClientOptions::new()
        .release(format!("cashmemo@{VERSION}"))
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
        opts = opts.dsn(&dsn);
    }
    if let Ok(env) = std::env::var("SENTRY_ENVIRONMENT") {
        opts = opts.environment(env);
    }
    let guard = sentry::init(opts);
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,sqlx=warn".into()))
        .with(tracing_subscriber::fmt::layer())
        .with(sentry::integrations::tracing::layer())
        .init();
    guard
}
