//! Immutable pinned currency reference endpoint.

use axum::Json;
use serde::Serialize;
use serde_json::Value;

use crate::auth::Principal;

const REGISTRY: &str =
    include_str!("../../../../../shared/currencies/iso4217-list-one-2026-01-01.json");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrencyRegistry {
    version: &'static str,
    source_effective_date: &'static str,
    currencies: Vec<CurrencyEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrencyEntry {
    code: String,
    minor_unit_scale: u8,
}

/// Returns only OpenAPI-declared immutable fields.
pub async fn currencies(Principal(_owner): Principal) -> Json<Value> {
    let value: Value = serde_json::from_str(REGISTRY).unwrap_or(Value::Null);
    let currencies = value
        .get("currencies")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    Some(CurrencyEntry {
                        code: entry.get("code")?.as_str()?.to_owned(),
                        minor_unit_scale: entry.get("minorUnitScale")?.as_u64()?.try_into().ok()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Json(
        serde_json::to_value(CurrencyRegistry {
            version: "iso4217-list-one-2026-01-01",
            source_effective_date: "2026-01-01",
            currencies,
        })
        .unwrap_or(Value::Null),
    )
}
