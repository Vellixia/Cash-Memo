//! Appwrite adapter using supported REST and GraphQL APIs only.

pub mod auth;
pub mod client;
pub mod create_money_memo;
pub mod journal_state_repository;
pub mod label_repository;
pub mod money_memo_repository;
pub mod query;

pub use auth::AppwriteSessionValidator;
pub use client::{AppwriteClient, AppwriteConfig, AppwriteError};
pub use create_money_memo::CreateMoneyMemoStore;
pub use journal_state_repository::{JournalGenerations, JournalStateStore};
pub use label_repository::LabelStore;
pub use money_memo_repository::MoneyMemoStore;
