pub mod routes;
mod service;

pub use service::{
    ArchiveResult, NewWallet, UpdateWallet, Wallet, WalletBalance, WalletError, WalletService,
};
