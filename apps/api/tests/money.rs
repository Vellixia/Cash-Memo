mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use cashmemo_api::{
    app::{AppState, build_app},
    currency::{CurrencyCode, CurrencyError, CurrencyRepository},
    money::{Money, MoneyError, format_exact_for_exponent, format_percentage_2dp},
    time::UserTimezone,
};
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::str::FromStr;
use tower::ServiceExt;

#[test]
fn rejects_excess_scale_without_rounding() {
    assert_eq!(
        Money::parse_for_exponent("1.1", 0).unwrap_err(),
        MoneyError::ExcessScale
    );
}

#[test]
fn preserves_four_digit_currency_exactly() {
    assert_eq!(
        Money::parse_for_exponent("12.3456", 4).unwrap().to_string(),
        "12.3456"
    );
}

#[test]
fn rejects_amounts_beyond_numeric_20_4_range() {
    assert_eq!(
        Money::parse_for_exponent("10000000000000000", 0).unwrap_err(),
        MoneyError::OutOfRange
    );
}

#[test]
fn serializes_as_an_exact_json_string() {
    let money = Money::parse_for_exponent("12.30", 2).unwrap();

    assert_eq!(serde_json::to_string(&money).unwrap(), "\"12.30\"");
    assert_eq!(money.decimal().to_string(), "12.30");
}

#[test]
fn exact_formatter_normalizes_trailing_zeroes_without_rounding() {
    assert_eq!(
        format_exact_for_exponent(Decimal::from_str("1.2300").unwrap(), 2).unwrap(),
        "1.23"
    );
}

#[test]
fn exact_formatter_rejects_corrupt_scale() {
    assert_eq!(
        format_exact_for_exponent(Decimal::from_str("1.231").unwrap(), 2).unwrap_err(),
        MoneyError::ExcessScale
    );
}

#[test]
fn exact_formatter_preserves_valid_negative_net() {
    assert_eq!(
        format_exact_for_exponent(Decimal::from_str("-1.20").unwrap(), 2).unwrap(),
        "-1.20"
    );
}

#[test]
fn percentage_formatter_rounds_to_two_decimal_places_explicitly() {
    assert_eq!(
        format_percentage_2dp(Decimal::from_str("12.345").unwrap()),
        "12.35"
    );
}

#[test]
fn rejects_unknown_iana_timezones() {
    assert!(UserTimezone::parse("Asia/NotAZone").is_err());
}

#[test]
fn preserves_valid_iana_timezone_name() {
    assert_eq!(
        UserTimezone::parse("Asia/Jakarta").unwrap().as_str(),
        "Asia/Jakarta"
    );
}

#[test]
fn rejects_noncanonical_currency_code_shape() {
    for code in ["usd", "US", "USDD", "US1"] {
        assert!(
            CurrencyCode::parse(code).is_err(),
            "{code} must be rejected"
        );
    }
}

#[sqlx::test(migrations = false)]
async fn application_rejects_excess_scale_before_raw_sql_can_round_it(pool: PgPool) {
    support::migrate_v1(&pool).await;

    assert_eq!(
        Money::parse_for_exponent("1.23456", 2).unwrap_err(),
        MoneyError::ExcessScale
    );

    let user: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ('scale@example.test', 'hash') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let stored: String = sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Raw SQL only', 'USD', 1.23456)
         RETURNING opening_balance::TEXT",
    )
    .bind(user)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(stored, "1.2346");
}

#[sqlx::test(migrations = false)]
async fn requires_enabled_currency_from_registry(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query(
        "INSERT INTO currencies (code, display_name, exponent, enabled)
         VALUES ('TST', 'Test currency', 3, FALSE)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let usd = CurrencyRepository::require_enabled(&pool, &CurrencyCode::parse("USD").unwrap())
        .await
        .unwrap();
    assert_eq!(usd.display_name, "US Dollar");
    assert_eq!(usd.exponent, 2);

    assert_eq!(
        CurrencyRepository::require_enabled(&pool, &CurrencyCode::parse("TST").unwrap())
            .await
            .unwrap_err(),
        CurrencyError::Disabled
    );
}

#[sqlx::test(migrations = false)]
async fn lists_only_enabled_currencies_in_code_order(pool: PgPool) {
    support::migrate_v1(&pool).await;
    sqlx::query(
        "INSERT INTO currencies (code, display_name, exponent, enabled)
         VALUES ('AAA', 'Alpha', 0, TRUE), ('ZZZ', 'Disabled', 2, FALSE)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let response = build_app(AppState { pool })
        .oneshot(
            Request::builder()
                .uri("/api/v1/currencies")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(response.into_body(), usize::MAX).await.unwrap(),
        r#"[{"code":"AAA","display_name":"Alpha","exponent":0},{"code":"EUR","display_name":"Euro","exponent":2},{"code":"IDR","display_name":"Indonesian Rupiah","exponent":0},{"code":"USD","display_name":"US Dollar","exponent":2}]"#,
    );
}
