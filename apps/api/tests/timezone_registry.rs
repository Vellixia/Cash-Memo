use chrono_tz::Tz;

#[test]
fn every_frontend_cashmemo_timezone_is_accepted_by_backend() {
    let registry: Vec<String> = serde_json::from_str(include_str!(
        "../../web/features/transactions/cashmemo-timezones.json"
    ))
    .expect("frontend Cashmemo timezone registry must be valid JSON");

    let rejected: Vec<&str> = registry
        .iter()
        .map(String::as_str)
        .filter(|timezone| timezone.parse::<Tz>().is_err())
        .collect();

    assert!(
        rejected.is_empty(),
        "frontend Cashmemo timezones rejected by chrono-tz 0.10.4: {rejected:?}"
    );
}
