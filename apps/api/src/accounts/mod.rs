mod deletion;
pub mod routes;

#[cfg(debug_assertions)]
pub use deletion::PasswordVerificationHook;
pub use deletion::{
    AccountDeletionError, AccountDeletionService, AccountStatus, DeletionClaim, DeletionStatus,
};
