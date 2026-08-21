use std::process::ExitCode;

use cashmemo_api::{
    app::{AppState, build_app_with_config},
    auth::AuthService,
    config::AppConfig,
    db::migrate::migrate_v1,
    error::ApiError,
};
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
    }

    Ok(())
}
