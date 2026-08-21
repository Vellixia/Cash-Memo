use std::process::ExitCode;

use cashmemo_api::{
    app::{AppState, build_app},
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
            axum::serve(listener, build_app(AppState { pool })).await?;
        }
        Command::Migrate => {
            migrate_v1(&pool).await?;
        }
    }

    Ok(())
}
