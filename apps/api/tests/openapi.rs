use cashmemo_api::openapi::ApiDoc;
use serde_json::Value;
use std::collections::BTreeSet;

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
    let recurring_resource = paths
        .get("/api/v1/recurring-transactions/{id}")
        .and_then(Value::as_object)
        .expect("recurring item path");
    assert!(
        !recurring_resource.contains_key("delete"),
        "approved recurring lifecycle exposes pause/resume, not DELETE"
    );

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

    let onboarding_schema = schemas
        .get("OnboardingContract")
        .and_then(Value::as_object)
        .expect("onboarding schema");
    let onboarding_required = onboarding_schema
        .get("required")
        .and_then(Value::as_array)
        .expect("onboarding required fields");
    assert!(onboarding_required.contains(&serde_json::json!("default_currency_code")));
    assert!(onboarding_required.contains(&serde_json::json!("timezone")));
    let onboarding = onboarding_schema
        .get("properties")
        .and_then(Value::as_object)
        .expect("onboarding properties");
    let default_currency_code = onboarding
        .get("default_currency_code")
        .and_then(Value::as_object)
        .expect("persisted default currency code");
    assert_eq!(
        default_currency_code.get("type"),
        Some(&serde_json::json!(["string", "null"]))
    );
    let timezone = onboarding
        .get("timezone")
        .and_then(Value::as_object)
        .expect("persisted reporting timezone");
    assert_eq!(
        timezone.get("type"),
        Some(&serde_json::json!(["string", "null"]))
    );

    let wallet_update = schemas
        .get("UpdateWalletRequest")
        .and_then(Value::as_object)
        .and_then(|value| value.get("properties"))
        .and_then(Value::as_object)
        .expect("wallet update properties");
    assert!(wallet_update.contains_key("name"));
    assert!(wallet_update.contains_key("opening_balance"));
    assert!(!wallet_update.contains_key("currency"));

    let serialized = serde_json::to_string(&document).expect("document JSON");
    for name in [
        "recurring-transactions",
        "recurring_transactions",
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

#[test]
fn recurring_contract_matches_authoritative_response_shape() {
    use cashmemo_api::{
        currency::CurrencyCode,
        recurring::{Cadence, RecurringStatus, RecurringTransaction},
        transactions::TransactionDirection,
    };

    let response = RecurringTransaction {
        id: uuid::Uuid::nil(),
        wallet_id: uuid::Uuid::nil(),
        category_id: uuid::Uuid::nil(),
        direction: TransactionDirection::Expense,
        amount: "10.00".to_owned(),
        currency: CurrencyCode::parse("USD").expect("valid currency"),
        note: Some("note".to_owned()),
        frequency: Cadence::Monthly,
        start_date: "2026-08-24".to_owned(),
        next_due_date: "2026-09-24".to_owned(),
        status: RecurringStatus::Active,
    };
    let serialized = serde_json::to_value(response).expect("recurring response serializes");
    let response_properties = serialized
        .as_object()
        .expect("recurring response object")
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();

    let document = serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI serializes");
    let schema = document
        .pointer("/components/schemas/RecurringTransaction")
        .expect("authoritative recurring schema");
    let schema_properties = schema["properties"]
        .as_object()
        .expect("recurring schema properties")
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    assert_eq!(schema_properties, response_properties);

    let required = schema["required"]
        .as_array()
        .expect("recurring schema required fields")
        .iter()
        .map(|field| field.as_str().expect("required field name").to_owned())
        .collect::<BTreeSet<_>>();
    let expected_required = [
        "id",
        "wallet_id",
        "category_id",
        "direction",
        "amount",
        "currency",
        "frequency",
        "start_date",
        "next_due_date",
        "status",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<BTreeSet<_>>();
    assert_eq!(required, expected_required);
}

#[test]
fn representative_operations_have_typed_http_contracts() {
    let document = serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI serializes");
    let operation = |path: &str, method: &str| {
        document
            .pointer(&format!("/paths/{}/{}", path.replace('/', "~1"), method))
            .unwrap_or_else(|| panic!("missing {method} {path}"))
            .clone()
    };

    let history = operation("/api/v1/transactions", "get");
    let history_params = history
        .get("parameters")
        .and_then(Value::as_array)
        .expect("history query params");
    for name in [
        "cursor",
        "limit",
        "q",
        "from",
        "to",
        "type",
        "wallet_id",
        "category_id",
    ] {
        assert!(history_params.iter().any(|param| param["name"] == name));
    }
    let create_transaction = operation("/api/v1/transactions", "post");
    assert_eq!(
        create_transaction["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/CreateTransactionRequest"
    );
    assert_eq!(
        create_transaction["responses"]["201"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/TransactionContract"
    );
    assert_error_response(&create_transaction, "422");

    let budget = operation("/api/v1/budgets", "post");
    assert_eq!(
        budget["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/CreateBudgetRequest"
    );
    assert_eq!(
        budget["responses"]["201"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/BudgetContract"
    );
    assert_error_response(&budget, "409");

    let deletion = operation("/api/v1/account/deletion", "post");
    assert_eq!(
        deletion["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/DeletionRequest"
    );
    assert_eq!(
        deletion["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/AccountDeletionContract"
    );
    for status in ["401", "403", "409", "422", "429", "500", "503"] {
        assert_error_response(&deletion, status);
    }
}

#[test]
fn cancellation_openapi_requires_password_body() {
    let document = serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI serializes");
    let cancellation = document
        .pointer("/paths/~1api~1v1~1account~1deletion~1cancel/post")
        .expect("cancellation operation");

    assert_eq!(
        cancellation["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/DeletionRequest"
    );
}

#[test]
fn repaired_dtos_publish_frozen_time_money_and_name_contracts() {
    let document = serde_json::to_value(ApiDoc::openapi()).expect("OpenAPI serializes");
    let schemas = document["components"]["schemas"]
        .as_object()
        .expect("component schemas");

    let properties = |name: &str| {
        schemas[name]["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("{name} properties"))
    };
    let required = |name: &str| {
        schemas[name]["required"]
            .as_array()
            .unwrap_or_else(|| panic!("{name} required fields"))
    };

    let deletion = properties("DeletionRequest");
    assert_eq!(
        deletion["password"]["description"],
        "Current password required to confirm account deletion or cancellation."
    );
    assert_eq!(deletion["password"]["format"], "password");

    for schema_name in ["CreateTransactionRequest", "UpdateTransactionRequest"] {
        let transaction = properties(schema_name);
        assert!(
            !transaction.contains_key("occurred_at"),
            "{schema_name} must not write occurred_at"
        );
        assert_eq!(
            transaction["occurred_local"]["pattern"],
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$"
        );
        assert_eq!(
            transaction["occurred_local"]["description"],
            "Optional user-local wall-clock minute (YYYY-MM-DDTHH:mm); omitted create uses server current instant and omitted update preserves stored instant."
        );
    }

    let transaction = properties("TransactionContract");
    for name in ["wallet_name", "category_name"] {
        assert!(
            transaction.contains_key(name),
            "missing current referenced name {name}"
        );
        assert_eq!(transaction[name]["type"], "string");
    }
    assert_eq!(transaction["occurred_at"]["readOnly"], true);
    assert_eq!(transaction["occurred_at"]["format"], "date-time");
    assert_eq!(
        transaction["occurred_at"]["description"],
        "Canonical UTC instant returned by the API; clients must write occurred_local instead."
    );

    let defaults = properties("EntryDefaults");
    assert!(required("EntryDefaults").contains(&serde_json::json!("timezone")));
    assert_eq!(defaults["timezone"]["type"], "string");
    assert_eq!(
        defaults["timezone"]["description"],
        "Authenticated user's IANA timezone for local financial entry."
    );

    let wallet = properties("UpdateWalletRequest");
    assert!(wallet.contains_key("name"));
    assert!(wallet.contains_key("opening_balance"));
    assert!(!wallet.contains_key("currency"));
    assert_eq!(
        wallet["opening_balance"]["type"],
        serde_json::json!(["string", "null"])
    );
    assert_eq!(
        wallet["opening_balance"]["description"],
        "Optional non-negative opening balance update; wallet currency remains immutable."
    );

    let category = properties("ExpenseCategoryContract");
    assert_eq!(category["share_percent"]["type"], "string");
    assert_eq!(
        category["share_percent"]["pattern"],
        r"^(?:100\.00|(?:0|[1-9][0-9]?)\.[0-9]{2})$"
    );
    assert_eq!(category["share_percent"]["example"], "33.33");
    assert_eq!(
        category["share_percent"]["description"],
        "Exact decimal percentage rounded to two places, in the inclusive range 0.00..100.00."
    );

    let operation = |path: &str, method: &str| {
        document
            .pointer(&format!("/paths/{}/{}", path.replace('/', "~1"), method))
            .unwrap_or_else(|| panic!("missing {method} {path}"))
    };
    let parameter = |path: &str, method: &str, name: &str| {
        operation(path, method)["parameters"]
            .as_array()
            .expect("operation parameters")
            .iter()
            .find(|parameter| parameter["name"] == name)
            .unwrap_or_else(|| panic!("missing parameter {name}"))
    };
    for name in ["from", "to"] {
        let parameter = parameter("/api/v1/transactions", "get", name);
        assert_eq!(parameter["schema"]["pattern"], r"^\d{4}-\d{2}-\d{2}$");
        assert_eq!(
            parameter["description"],
            "Inclusive user-local calendar date (YYYY-MM-DD)."
        );
    }
    let month_expectations = [
        ("/api/v1/budgets", "Omitted returns all budgets."),
        (
            "/api/v1/reports/budget-summary",
            "Omitted defaults to current month.",
        ),
        (
            "/api/v1/reports/monthly-summary",
            "Omitted defaults to current month.",
        ),
        (
            "/api/v1/transactions/recent",
            "Omitted leaves month unbounded and returns latest transactions.",
        ),
    ];
    for (path, omission) in month_expectations {
        let month = parameter(path, "get", "month");
        assert_eq!(month["schema"]["pattern"], r"^\d{4}-\d{2}$");
        assert_eq!(
            month["description"],
            format!("Selected user-local calendar month (YYYY-MM). {omission}")
        );
    }
}

fn assert_error_response(operation: &Value, status: &str) {
    assert_eq!(
        operation["responses"][status]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/ErrorEnvelope",
        "response {status} must use canonical error envelope"
    );
}
