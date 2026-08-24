use std::process::ExitCode;

#[cfg(feature = "s3-receipts")]
use cashmemo_api::accounts::AccountDeletionService;
use cashmemo_api::{
    app::{AppState, build_app_with_config},
    auth::AuthService,
    config::{AppConfig, database_url_from_env},
    db::migrate::migrate_v1,
    error::ApiError,
    recurring::{ProcessOptions, RecurringProcessor},
    transactions::TransactionService,
};
use clap::{Parser, Subcommand};
use sqlx::postgres::PgPoolOptions;

const MAX_BATCH_SIZE: i64 = 10_000;
const MAX_RECURRING_BATCH_SIZE: u64 = 10_000;
const MAX_OCCURRENCES_PER_RULE: u64 = 366;

#[derive(Debug, Parser)]
#[command(name = "cashmemo-api")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Serve,
    Migrate,
    CleanupAuthTokens {
        #[arg(long, value_parser = clap::value_parser!(i64).range(1..=MAX_BATCH_SIZE))]
        batch_size: i64,
    },
    PurgeTrash {
        #[arg(long, value_parser = clap::value_parser!(i64).range(1..=MAX_BATCH_SIZE))]
        batch_size: i64,
    },
    ProcessRecurring {
        #[arg(long, value_parser = clap::value_parser!(u64).range(1..=MAX_RECURRING_BATCH_SIZE))]
        batch_size: u64,
        #[arg(long, value_parser = clap::value_parser!(u64).range(1..=MAX_OCCURRENCES_PER_RULE))]
        max_occurrences_per_recurring_transaction: u64,
    },
    #[cfg(feature = "s3-receipts")]
    PurgeAccounts {
        #[arg(long, value_parser = clap::value_parser!(u64).range(1..=MAX_RECURRING_BATCH_SIZE))]
        batch_size: u64,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), ApiError> {
    let cli = Cli::parse();

    match cli.command {
        Command::Serve => {
            let config = AppConfig::from_env()?;
            init_logging(config.log_level);
            let pool = connect_database(&config.database_url).await?;
            let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
            axum::serve(
                listener,
                build_app_with_config(AppState { pool }, &config)
                    .into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .with_graceful_shutdown(shutdown_signal())
            .await?;
        }
        Command::Migrate => {
            let pool = connect_command_database().await?;
            migrate_v1(&pool).await?;
            print_summary("migrate", 1);
        }
        Command::CleanupAuthTokens { batch_size } => {
            let pool = connect_command_database().await?;
            let processed = AuthService::cleanup_tokens(&pool, batch_size)
                .await
                .map_err(|_| ApiError::AuthCleanup)?;
            print_summary("cleanup-auth-tokens", processed);
        }
        Command::PurgeTrash { batch_size } => {
            let pool = connect_command_database().await?;
            let processed = TransactionService::new(pool)
                .purge_trash(batch_size)
                .await
                .map_err(|_| ApiError::TrashPurge)?;
            print_summary("purge-trash", processed);
        }
        Command::ProcessRecurring {
            batch_size,
            max_occurrences_per_recurring_transaction,
        } => {
            let pool = connect_command_database().await?;
            let result = RecurringProcessor::new(pool)
                .process(ProcessOptions {
                    batch_size,
                    max_occurrences_per_recurring_transaction,
                })
                .await
                .map_err(|_| ApiError::RecurringProcess)?;
            print_summary("process-recurring", result.generated);
        }
        #[cfg(feature = "s3-receipts")]
        Command::PurgeAccounts { batch_size } => {
            use cashmemo_api::{
                config::DeletionReceiptCommandConfig, receipts::s3::S3DeletionReceiptStore,
            };
            let environment = cashmemo_api::config::AppEnvironment::from_env()?;
            let receipt_config = DeletionReceiptCommandConfig::from_env(environment)?;
            let store = S3DeletionReceiptStore::connect(receipt_config.s3.clone())
                .await
                .map_err(|_| ApiError::AccountPurge)?;
            let pool = connect_command_database().await?;
            let deletion = AccountDeletionService::new(pool);
            let worker_token = uuid::Uuid::new_v4().to_string();
            let (key_version, key) = receipt_config.current_hmac_key();
            let mut processed = 0;
            for _ in 0..batch_size {
                let Some(claim) = deletion
                    .claim_next(&worker_token, std::time::Duration::from_secs(60))
                    .await
                    .map_err(|_| ApiError::AccountPurge)?
                else {
                    break;
                };
                deletion
                    .purge_claim(&claim, key, *key_version, &store)
                    .await
                    .map_err(|_| ApiError::AccountPurge)?;
                processed += 1;
            }
            print_summary("purge-accounts", processed);
        }
    }

    Ok(())
}

async fn connect_command_database() -> Result<sqlx::PgPool, ApiError> {
    connect_database(&database_url_from_env()?).await
}

async fn connect_database(database_url: &str) -> Result<sqlx::PgPool, ApiError> {
    Ok(PgPoolOptions::new().connect(database_url).await?)
}

fn print_summary(command: &str, processed: u64) {
    println!(
        "{}",
        serde_json::json!({ "command": command, "processed": processed })
    );
}

fn init_logging(level: cashmemo_api::config::LogLevel) {
    use tracing_subscriber::util::SubscriberInitExt;

    tracing_subscriber::fmt()
        .json()
        .with_ansi(false)
        .with_current_span(false)
        .with_env_filter(tracing_subscriber::EnvFilter::new(level.as_str()))
        .with_span_list(false)
        .with_target(false)
        .finish()
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C signal handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
