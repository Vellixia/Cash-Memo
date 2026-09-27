//! Background jobs from the `jobs` table: email today, CSV export/import next.
//! Runs with a tiny DB pool so it can never starve the API.
use worker::{data, email};

use std::time::Duration;

use domain::jobs;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};

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
    let mut opts = ConnectOptions::new(url);
    opts.max_connections(2)
        .min_connections(1)
        .sqlx_logging(false);
    let db = Database::connect(opts).await.expect("connect db");
    // The API owns migrations; wait for it instead of racing it.
    while !has_jobs_table(&db).await {
        tracing::info!("waiting for the API to run migrations");
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    match jobs::requeue_stale(&db).await {
        Ok(n) if n > 0 => tracing::warn!("requeued {n} stale jobs"),
        Ok(_) => {}
        Err(e) => tracing::error!("requeue stale jobs: {e}"),
    }

    let mailer = email::Mailer::from_env();
    tracing::info!("worker started (email: {})", mailer.mode());
    let data = async {
        match domain::storage::Storage::from_env() {
            Some(storage) => {
                let http = reqwest::Client::builder()
                    .timeout(Duration::from_secs(300))
                    .build()
                    .expect("http client");
                data::run(data::Ctx {
                    db: db.clone(),
                    storage,
                    http,
                })
                .await
            }
            None => {
                tracing::warn!("S3_* not set: CSV export/import jobs will wait");
                std::future::pending().await
            }
        }
    };
    tokio::select! {
        _ = email::run(db.clone(), mailer) => {},
        _ = data => {},
        _ = shutdown() => tracing::info!("shutting down"),
    }
}

async fn has_jobs_table(db: &DatabaseConnection) -> bool {
    use sea_orm::{ConnectionTrait, DbBackend, Statement};
    db.query_one_raw(Statement::from_string(
        DbBackend::Postgres,
        "SELECT 1 AS ok FROM pg_tables WHERE tablename = 'jobs'",
    ))
    .await
    .ok()
    .flatten()
    .is_some()
}

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
}
