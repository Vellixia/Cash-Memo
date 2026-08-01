//! Framework-independent Money Memo domain.

pub mod create;
pub mod error;
pub mod identifiers;
pub mod label;
pub mod lifecycle;
pub mod money;
pub mod money_memo;
pub mod occurrence;
pub mod privacy;
pub mod privacy_pattern_v1;

pub use error::{DomainError, ErrorCode, FieldViolation};
pub use identifiers::{CreationId, LabelId, MoneyMemoId, OwnerId, Revision, Timestamp};
pub use label::Label;
pub use money_memo::MoneyMemo;
