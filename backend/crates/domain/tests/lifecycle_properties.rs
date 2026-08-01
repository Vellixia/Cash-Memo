//! Lifecycle exact-boundary and invariant tests.

use cashmemo_domain::Timestamp;
use cashmemo_domain::lifecycle::{EffectiveLifecycle, Lifecycle, LifecycleStatus};

#[test]
fn exact_deadline_is_expired() {
    let deadline = Timestamp::from_micros(2_000);
    let lifecycle = Lifecycle {
        status: LifecycleStatus::PendingDeletion,
        pre_delete_status: Some(LifecycleStatus::Active),
        deletion_requested_at: Some(Timestamp::from_micros(1_000)),
        purge_deadline: Some(deadline),
    };
    assert_eq!(
        lifecycle.effective(Timestamp::from_micros(1_999)),
        EffectiveLifecycle::PendingDeletion
    );
    assert_eq!(lifecycle.effective(deadline), EffectiveLifecycle::Expired);
    assert_eq!(
        lifecycle.effective(Timestamp::from_micros(2_001)),
        EffectiveLifecycle::Expired
    );
}

#[test]
fn nullable_fields_follow_stored_state() {
    assert!(Lifecycle::ACTIVE.validate().is_ok());
    assert!(
        Lifecycle {
            status: LifecycleStatus::Archived,
            pre_delete_status: None,
            deletion_requested_at: None,
            purge_deadline: None,
        }
        .validate()
        .is_ok()
    );
    assert!(
        Lifecycle {
            status: LifecycleStatus::Active,
            pre_delete_status: None,
            deletion_requested_at: None,
            purge_deadline: Some(Timestamp::from_micros(1)),
        }
        .validate()
        .is_err()
    );
    assert!(
        Lifecycle {
            status: LifecycleStatus::PendingDeletion,
            pre_delete_status: Some(LifecycleStatus::PendingDeletion),
            deletion_requested_at: Some(Timestamp::from_micros(1)),
            purge_deadline: Some(Timestamp::from_micros(2)),
        }
        .validate()
        .is_err()
    );
}
