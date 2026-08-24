use cashmemo_api::openapi::ApiDoc;
use serde_json::Value;

#[test]
fn rust_openapi_freezes_v1_contract_names() {
    let document = serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI serializes");
    let paths = document
        .get("paths")
        .and_then(Value::as_object)
        .expect("paths object");

    assert!(paths.contains_key("/api/v1/reports/budget-summary"));
    assert!(!paths.contains_key("/api/v1/reports/budgets"));
    assert!(paths.contains_key("/api/v1/health/live"));
    assert!(paths.contains_key("/api/v1/health/ready"));
    assert!(!paths.contains_key("/api/v1/health"));

    let schemas = document
        .get("components")
        .and_then(|value| value.get("schemas"))
        .and_then(Value::as_object)
        .expect("component schemas");
    let error = schemas
        .get("ErrorBody")
        .and_then(Value::as_object)
        .expect("canonical error schema");
    let error_properties = error
        .get("properties")
        .and_then(Value::as_object)
        .expect("error properties");
    assert!(error_properties.contains_key("fields"));
    assert!(!error_properties.contains_key("issues"));

    let defaults = schemas
        .get("EntryDefaults")
        .and_then(Value::as_object)
        .and_then(|value| value.get("properties"))
        .and_then(Value::as_object)
        .expect("entry defaults");
    assert!(defaults.contains_key("last_used_wallet_id"));

    let serialized = serde_json::to_string(&document).expect("document JSON");
    for name in [
        "recurring-transactions",
        "recurring_transactions",
        "recurring_transaction_id",
        "recurring_occurrence_id",
    ] {
        assert!(serialized.contains(name), "missing {name}");
    }

    let expected_paths = [
        "/api/v1/account/deletion",
        "/api/v1/account/deletion/cancel",
        "/api/v1/auth/login",
        "/api/v1/auth/logout",
        "/api/v1/auth/password-reset/consume",
        "/api/v1/auth/password-reset/request",
        "/api/v1/auth/register",
        "/api/v1/auth/sessions/current",
        "/api/v1/auth/sessions/revoke-all",
        "/api/v1/auth/verification/resend",
        "/api/v1/auth/verify-email",
        "/api/v1/budgets",
        "/api/v1/budgets/{budget_id}",
        "/api/v1/categories",
        "/api/v1/categories/{category_id}",
        "/api/v1/categories/{category_id}/archive",
        "/api/v1/categories/{category_id}/restore",
        "/api/v1/currencies",
        "/api/v1/health/live",
        "/api/v1/health/ready",
        "/api/v1/onboarding",
        "/api/v1/onboarding/seed-categories",
        "/api/v1/recurring-transactions",
        "/api/v1/recurring-transactions/{id}",
        "/api/v1/recurring-transactions/{id}/pause",
        "/api/v1/recurring-transactions/{id}/resume",
        "/api/v1/reports/budget-summary",
        "/api/v1/reports/monthly-summary",
        "/api/v1/settings/preferences",
        "/api/v1/transactions",
        "/api/v1/transactions/{transaction_id}",
        "/api/v1/transactions/{transaction_id}/permanent",
        "/api/v1/transactions/{transaction_id}/restore",
        "/api/v1/transactions/entry-defaults",
        "/api/v1/transactions/recent",
        "/api/v1/transactions/trash",
        "/api/v1/wallets",
        "/api/v1/wallets/{wallet_id}",
        "/api/v1/wallets/{wallet_id}/archive",
        "/api/v1/wallets/{wallet_id}/restore",
    ];
    assert_eq!(paths.len(), expected_paths.len());
    for path in expected_paths {
        assert!(paths.contains_key(path), "missing route {path}");
    }

    let first = serde_json::to_vec(&ApiDoc::openapi()).expect("first export");
    let second = serde_json::to_vec(&ApiDoc::openapi()).expect("second export");
    assert_eq!(first, second, "Rust export must be deterministic");
}
