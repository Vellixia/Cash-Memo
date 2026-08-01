//! Occurrence identity, boundary, and display tests.

use cashmemo_domain::Timestamp;
use cashmemo_domain::occurrence::{LocalWall, Occurrence, UtcOffset, ZoneResolution};

fn timestamp(value: &str) -> Timestamp {
    let Ok(value) = Timestamp::parse_canonical(value) else {
        panic!("valid test timestamp rejected")
    };
    value
}

fn wall(value: &str) -> LocalWall {
    let Ok(value) = LocalWall::parse(value) else {
        panic!("valid test wall rejected")
    };
    value
}

fn offset(value: &str) -> UtcOffset {
    let Ok(value) = UtcOffset::parse(value) else {
        panic!("valid test offset rejected")
    };
    value
}

#[test]
fn canonical_time_and_offset_boundaries() {
    assert_eq!(
        timestamp("2026-07-30T12:15:00.000000Z")
            .to_canonical()
            .ok()
            .as_deref(),
        Some("2026-07-30T12:15:00.000000Z")
    );
    for invalid in [
        "2026-07-30T12:15:00Z",
        "2026-07-30T12:15:00.000Z",
        "2026-07-30T12:15:00.000000+00:00",
    ] {
        assert!(Timestamp::parse_canonical(invalid).is_err());
    }
    for valid in ["-14:00", "-13:59", "+00:00", "+13:59", "+14:00"] {
        assert!(UtcOffset::parse(valid).is_ok());
    }
    for invalid in ["-14:01", "-14:59", "+14:01", "+14:59", "+15:00"] {
        assert!(UtcOffset::parse(invalid).is_err());
    }
}

#[test]
fn instant_wall_offset_identity_and_mixed_local_dates() {
    let first = Occurrence::new(
        timestamp("2026-07-30T23:30:00.000000Z"),
        wall("2026-07-31T13:30:00.000000"),
        offset("+14:00"),
        ZoneResolution::Unique,
    );
    let second = Occurrence::new(
        timestamp("2026-07-30T23:30:00.000000Z"),
        wall("2026-07-30T09:30:00.000000"),
        offset("-14:00"),
        ZoneResolution::Unique,
    );
    let (Ok(first), Ok(second)) = (first, second) else {
        panic!("valid mixed-offset occurrence rejected")
    };
    assert_ne!(first.local_date(), second.local_date());
    assert_eq!(first.instant(), second.instant());
}

#[test]
fn device_zone_projection_changes_no_stored_value() {
    let occurrence = Occurrence::new(
        timestamp("2026-07-30T12:15:00.000000Z"),
        wall("2026-07-30T19:15:00.000000"),
        offset("+07:00"),
        ZoneResolution::Unique,
    );
    let Ok(occurrence) = occurrence else {
        panic!("valid occurrence rejected")
    };
    let before = occurrence.clone();
    assert_eq!(
        occurrence
            .display_in_offset(offset("-05:00"))
            .ok()
            .as_deref(),
        Some("2026-07-30T07:15:00.000000")
    );
    assert_eq!(occurrence, before);
}

#[test]
fn ambiguity_requires_choice_and_gap_is_rejected() {
    assert!(
        Occurrence::new(
            timestamp("2026-11-01T05:30:00.000000Z"),
            wall("2026-11-01T01:30:00.000000"),
            offset("-04:00"),
            ZoneResolution::AmbiguousOffsetChosen,
        )
        .is_ok()
    );
    assert!(
        Occurrence::new(
            timestamp("2026-03-08T07:30:00.000000Z"),
            wall("2026-03-08T02:30:00.000000"),
            offset("-05:00"),
            ZoneResolution::Nonexistent,
        )
        .is_err()
    );
}

#[test]
fn ten_year_range_uses_submitted_local_date() {
    let occurrence = Occurrence::new(
        timestamp("2036-08-01T00:00:00.000000Z"),
        wall("2036-08-01T07:00:00.000000"),
        offset("+07:00"),
        ZoneResolution::Unique,
    );
    let Ok(occurrence) = occurrence else {
        panic!("boundary occurrence rejected")
    };
    assert!(
        occurrence
            .validate_range(timestamp("2026-08-01T00:00:00.000000Z"))
            .is_ok()
    );
}
