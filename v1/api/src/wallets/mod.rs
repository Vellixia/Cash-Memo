pub mod routes;
mod service;

pub use service::{NewWallet, UpdateWallet, Wallet, WalletBalance, WalletError, WalletService};
