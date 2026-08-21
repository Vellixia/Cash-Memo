use std::process::ExitCode;

use cashmemo_api::{
    app::{AppState, build_app_with_config},
    auth::AuthService,
    config::AppConfig,
    db::migrate::migrate_v1,
    error::ApiError,
    recurring::{ProcessOptions, RecurringProcessor},
    transactions::TransactionService,
};
#[cfg(feature = "s3-receipts")]
use cashmemo_api::accounts::AccountDeletionService;
use clap::{Parser, Subcommand};
use sqlx::postgres::PgPoolOptions;

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
        #[arg(long)]
        batch_size: i64,
    },
    PurgeTrash {
        #[arg(long)]
        batch_size: i64,
    },
    ProcessRecurring {
        #[arg(long)]
        batch_size: u64,
        #[arg(long)]
        max_occurrences_per_recurring_transaction: u64,
    },
    #[cfg(feature = "s3-receipts")]
    PurgeAccounts {
        #[arg(long)]
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
    let config = AppConfig::from_env()?;
    let pool = PgPoolOptions::new().connect(&config.database_url).await?;

    match cli.command {
        Command::Serve => {
            let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
            axum::serve(
                listener,
                build_app_with_config(AppState { pool }, &config)
                    .into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await?;
        }
        Command::Migrate => {
            migrate_v1(&pool).await?;
        }
        Command::CleanupAuthTokens { batch_size } => {
            AuthService::cleanup_tokens(&pool, batch_size)
                .await
                .map_err(|_| ApiError::AuthCleanup)?;
        }
        Command::PurgeTrash { batch_size } => {
            TransactionService::new(pool)
                .purge_trash(batch_size)
                .await
                .map_err(|_| ApiError::TrashPurge)?;
        }
        Command::ProcessRecurring {
            batch_size,
            max_occurrences_per_recurring_transaction,
        } => {
            RecurringProcessor::new(pool)
                .process(ProcessOptions {
                    batch_size,
                    max_occurrences_per_recurring_transaction,
                })
                .await
                .map_err(|_| ApiError::RecurringProcess)?;
        }
        #[cfg(feature = "s3-receipts")]
        Command::PurgeAccounts { batch_size } => {
            use cashmemo_api::{config::DeletionReceiptCommandConfig, receipts::s3::S3DeletionReceiptStore};
            let receipt_config = DeletionReceiptCommandConfig::from_env()?;
            let store = S3DeletionReceiptStore::connect(receipt_config.s3.clone()).await.map_err(|_| ApiError::AccountPurge)?;
            let deletion = AccountDeletionService::new(pool);
            let worker_token = uuid::Uuid::new_v4().to_string();
            let (key_version, key) = receipt_config.current_hmac_key();
            for _ in 0..batch_size {
                let Some(claim) = deletion.claim_next(&worker_token, std::time::Duration::from_secs(60)).await.map_err(|_| ApiError::AccountPurge)? else { break; };
                deletion.purge_claim(&claim, key, *key_version, &store).await.map_err(|_| ApiError::AccountPurge)?;
            }
        }
    }

    Ok(())
}
