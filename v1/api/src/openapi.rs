//! Rust-owned OpenAPI contract for V1.
//!
//! Route handlers stay in their feature modules. This module owns the public contract so
//! exporting the document never depends on database state or runtime configuration.

use std::collections::BTreeMap;

use serde::Serialize;
use utoipa::ToSchema;
use utoipa::openapi::{
    ComponentsBuilder, ContentBuilder, Info, OpenApiBuilder, PathItem, PathsBuilder, Ref, Required,
    path::{HttpMethod, OperationBuilder, ParameterBuilder, ParameterIn},
    request_body::RequestBodyBuilder,
    response::{ResponseBuilder, ResponsesBuilder},
    schema::{ArrayBuilder, ObjectBuilder, Type},
};
use uuid::Uuid;

use crate::{
    currency::CurrencyCode,
    recurring::{Cadence, RecurringStatus, RecurringTransaction},
    transactions::TransactionDirection,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    #[schema(value_type = Option<Object>)]
    pub fields: Option<BTreeMap<String, Vec<String>>>,
    pub request_id: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EntryDefaults {
    pub last_used_wallet_id: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecurringTransactionsContract {
    pub recurring_transactions: Vec<RecurringTransaction>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TransactionContract {
    pub id: Uuid,
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub recurring_occurrence_id: Option<Uuid>,
    pub direction: String,
    pub amount: String,
    pub currency: String,
    pub occurred_at: String,
    pub note: Option<String>,
    pub deleted_at: Option<String>,
    pub purge_after: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WalletContract {
    pub id: Uuid,
    pub name: String,
    pub currency: String,
    pub opening_balance: String,
    pub archived_at: Option<String>,
    pub balance: WalletBalanceContract,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WalletBalanceContract {
    pub currency: String,
    pub amount: String,
    pub as_of: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CategoryContract {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BudgetContract {
    pub id: Uuid,
    pub category_id: Uuid,
    pub currency: String,
    pub month: String,
    pub amount: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BudgetSummaryContract {
    pub month: String,
    pub budgets: Vec<BudgetProgressContract>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BudgetProgressContract {
    pub id: Uuid,
    pub category_id: Uuid,
    pub currency: String,
    pub budgeted: String,
    pub spent: String,
    pub remaining: String,
    pub progress: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MonthlySummaryContract {
    pub month: String,
    pub currencies: Vec<CurrencySummaryContract>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CurrencySummaryContract {
    pub currency: String,
    pub income: String,
    pub expense: String,
    pub net: String,
    pub expense_categories: Vec<ExpenseCategoryContract>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ExpenseCategoryContract {
    pub category_id: Uuid,
    pub name: String,
    pub expense: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecentTransactionsContract {
    pub items: Vec<TransactionContract>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OnboardingContract {
    pub timezone_configured: bool,
    #[schema(required = true)]
    pub timezone: Option<String>,
    pub default_currency_configured: bool,
    #[schema(required = true)]
    pub default_currency_code: Option<String>,
    pub categories_seeded: bool,
    pub has_active_wallet: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AccountDeletionContract {
    pub status: String,
    pub deletion_due_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CurrencyContract {
    pub code: String,
    pub display_name: String,
    pub exponent: u32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionContract {
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub access: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AcceptedContract {
    pub accepted: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CredentialsRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EmailRequest {
    pub email: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TokenRequest {
    pub token: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PreferencesRequest {
    pub timezone: String,
    pub default_currency_code: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateTransactionRequest {
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub direction: String,
    pub amount: String,
    pub note: Option<String>,
    pub occurred_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateTransactionRequest {
    pub wallet_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub direction: Option<String>,
    pub amount: Option<String>,
    pub note: Option<String>,
    pub occurred_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(rename = "type")]
    pub transaction_type: Option<String>,
    pub wallet_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub q: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HistoryPageContract {
    pub items: Vec<TransactionContract>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateBudgetRequest {
    pub category_id: Uuid,
    pub currency: String,
    pub month: String,
    pub amount: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateBudgetRequest {
    pub category_id: Option<Uuid>,
    pub currency: Option<String>,
    pub month: Option<String>,
    pub amount: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeletionRequest {
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateWalletRequest {
    pub name: String,
    pub currency: String,
    pub opening_balance: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateWalletRequest {
    pub name: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateCategoryRequest {
    pub name: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateRecurringTransactionRequest {
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub direction: String,
    pub amount: String,
    pub note: Option<String>,
    pub frequency: String,
    pub start_date: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateRecurringTransactionRequest {
    pub wallet_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub direction: Option<String>,
    pub amount: Option<String>,
    pub note: Option<String>,
    pub frequency: Option<String>,
    pub start_date: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MonthQuery {
    pub month: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PasswordResetRequest {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WalletArchiveContract {
    pub id: Uuid,
    pub name: String,
    pub currency: String,
    pub opening_balance: String,
    pub archived_at: Option<String>,
    pub balance: WalletBalanceContract,
    pub paused_recurring_count: u64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CategoryArchiveContract {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
    pub archived_at: Option<String>,
    pub paused_recurring_count: u64,
}

/// Complete deterministic V1 contract.
pub struct ApiDoc;

impl ApiDoc {
    pub fn openapi() -> utoipa::openapi::OpenApi {
        let components = ComponentsBuilder::new()
            .schema_from::<ErrorBody>()
            .schema_from::<ErrorEnvelope>()
            .schema_from::<EntryDefaults>()
            .schema_from::<CurrencyCode>()
            .schema_from::<Cadence>()
            .schema_from::<RecurringStatus>()
            .schema_from::<TransactionDirection>()
            .schema_from::<RecurringTransaction>()
            .schema_from::<RecurringTransactionsContract>()
            .schema_from::<TransactionContract>()
            .schema_from::<WalletContract>()
            .schema_from::<WalletBalanceContract>()
            .schema_from::<CategoryContract>()
            .schema_from::<BudgetContract>()
            .schema_from::<BudgetSummaryContract>()
            .schema_from::<BudgetProgressContract>()
            .schema_from::<MonthlySummaryContract>()
            .schema_from::<CurrencySummaryContract>()
            .schema_from::<ExpenseCategoryContract>()
            .schema_from::<RecentTransactionsContract>()
            .schema_from::<OnboardingContract>()
            .schema_from::<AccountDeletionContract>()
            .schema_from::<CurrencyContract>()
            .schema_from::<SessionContract>()
            .schema_from::<AcceptedContract>()
            .schema_from::<CredentialsRequest>()
            .schema_from::<EmailRequest>()
            .schema_from::<TokenRequest>()
            .schema_from::<PreferencesRequest>()
            .schema_from::<CreateTransactionRequest>()
            .schema_from::<UpdateTransactionRequest>()
            .schema_from::<HistoryQuery>()
            .schema_from::<HistoryPageContract>()
            .schema_from::<CreateBudgetRequest>()
            .schema_from::<UpdateBudgetRequest>()
            .schema_from::<DeletionRequest>()
            .schema_from::<CreateWalletRequest>()
            .schema_from::<UpdateWalletRequest>()
            .schema_from::<CreateCategoryRequest>()
            .schema_from::<UpdateCategoryRequest>()
            .schema_from::<CreateRecurringTransactionRequest>()
            .schema_from::<UpdateRecurringTransactionRequest>()
            .schema_from::<MonthQuery>()
            .schema_from::<PasswordResetRequest>()
            .schema_from::<WalletArchiveContract>()
            .schema_from::<CategoryArchiveContract>()
            .build();

        OpenApiBuilder::new()
            .info(Info::new("Cashmemo V1 API", "1.0.0"))
            .paths(paths())
            .components(Some(components))
            .build()
    }
}

struct Contract {
    request: Option<&'static str>,
    response: Option<(&'static str, bool)>,
    success_status: &'static str,
    query: &'static [&'static str],
    errors: &'static [&'static str],
}

const AUTH_ERRORS: &[&str] = &["401", "403", "404", "409", "422", "429", "500", "503"];
const PUBLIC_ERRORS: &[&str] = &["401", "422", "429", "500", "503"];
const QUERY_HISTORY: &[&str] = &[
    "from",
    "to",
    "type",
    "wallet_id",
    "category_id",
    "q",
    "cursor",
    "limit",
];
const QUERY_MONTH: &[&str] = &["month"];

fn contract(operation_id: &str) -> Contract {
    let authenticated = Contract {
        request: None,
        response: None,
        success_status: "200",
        query: &[],
        errors: AUTH_ERRORS,
    };
    match operation_id {
        "register" | "login" => Contract {
            request: Some("CredentialsRequest"),
            response: Some((
                if operation_id == "login" {
                    "SessionContract"
                } else {
                    "AcceptedContract"
                },
                false,
            )),
            success_status: "200",
            query: &[],
            errors: PUBLIC_ERRORS,
        },
        "verify_email" | "consume_password_reset" => Contract {
            request: Some(if operation_id == "verify_email" {
                "TokenRequest"
            } else {
                "PasswordResetRequest"
            }),
            response: Some(("AcceptedContract", false)),
            success_status: "200",
            query: &[],
            errors: PUBLIC_ERRORS,
        },
        "resend_verification" | "request_password_reset" => Contract {
            request: Some("EmailRequest"),
            response: Some(("AcceptedContract", false)),
            success_status: "200",
            query: &[],
            errors: PUBLIC_ERRORS,
        },
        "logout" | "revoke_all_sessions" => Contract {
            request: None,
            response: Some(("AcceptedContract", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "current_session" => json("SessionContract"),
        "get_onboarding" | "seed_onboarding_categories" | "update_preferences" => Contract {
            request: (operation_id == "update_preferences").then_some("PreferencesRequest"),
            response: Some(("OnboardingContract", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "get_account_deletion" | "cancel_account_deletion" => Contract {
            request: None,
            response: Some(("AccountDeletionContract", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "request_account_deletion" => Contract {
            request: Some("DeletionRequest"),
            response: Some(("AccountDeletionContract", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "list_currencies" => Contract {
            request: None,
            response: Some(("CurrencyContract", true)),
            success_status: "200",
            query: &[],
            errors: &["500", "503"],
        },
        "health_live" => Contract {
            request: None,
            response: None,
            success_status: "200",
            query: &[],
            errors: &[],
        },
        "health_ready" => Contract {
            request: None,
            response: None,
            success_status: "200",
            query: &[],
            errors: &["500", "503"],
        },
        "list_wallets" => list("WalletContract", &[]),
        "create_wallet" => create("CreateWalletRequest", "WalletContract"),
        "get_wallet" | "update_wallet" | "restore_wallet" => Contract {
            request: (operation_id == "update_wallet").then_some("UpdateWalletRequest"),
            response: Some(("WalletContract", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "archive_wallet" => json("WalletArchiveContract"),
        "delete_wallet" => no_content(),
        "list_categories" => list("CategoryContract", &[]),
        "create_category" => create("CreateCategoryRequest", "CategoryContract"),
        "get_category" | "update_category" | "restore_category" => Contract {
            request: (operation_id == "update_category").then_some("UpdateCategoryRequest"),
            response: Some(("CategoryContract", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "archive_category" => json("CategoryArchiveContract"),
        "delete_category" => no_content(),
        "list_budgets" => Contract {
            query: QUERY_MONTH,
            ..list("BudgetContract", &[])
        },
        "create_budget" => create("CreateBudgetRequest", "BudgetContract"),
        "update_budget" => Contract {
            request: Some("UpdateBudgetRequest"),
            response: Some(("BudgetContract", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "delete_budget" => no_content(),
        "get_budget_summary" => Contract {
            query: QUERY_MONTH,
            ..json("BudgetSummaryContract")
        },
        "get_transaction_entry_defaults" => json("EntryDefaults"),
        "list_transactions" | "list_trashed_transactions" => Contract {
            request: None,
            response: Some(("HistoryPageContract", false)),
            success_status: "200",
            query: QUERY_HISTORY,
            errors: AUTH_ERRORS,
        },
        "create_transaction" => create("CreateTransactionRequest", "TransactionContract"),
        "get_transaction" | "update_transaction" | "trash_transaction" | "restore_transaction" => {
            Contract {
                request: (operation_id == "update_transaction")
                    .then_some("UpdateTransactionRequest"),
                response: Some(("TransactionContract", false)),
                success_status: "200",
                query: &[],
                errors: AUTH_ERRORS,
            }
        }
        "permanently_delete_transaction" => no_content(),
        "list_recurring_transactions" => list("RecurringTransaction", &[]),
        "create_recurring_transaction" => {
            create("CreateRecurringTransactionRequest", "RecurringTransaction")
        }
        "get_recurring_transaction"
        | "update_recurring_transaction"
        | "pause_recurring_transaction"
        | "resume_recurring_transaction" => Contract {
            request: (operation_id == "update_recurring_transaction")
                .then_some("UpdateRecurringTransactionRequest"),
            response: Some(("RecurringTransaction", false)),
            success_status: "200",
            query: &[],
            errors: AUTH_ERRORS,
        },
        "delete_recurring_transaction" => no_content(),
        "get_monthly_summary" => Contract {
            query: QUERY_MONTH,
            ..json("MonthlySummaryContract")
        },
        "get_recent_transactions" => json("RecentTransactionsContract"),
        _ => authenticated,
    }
}

fn list(response: &'static str, query: &'static [&'static str]) -> Contract {
    Contract {
        request: None,
        response: Some((response, true)),
        success_status: "200",
        query,
        errors: AUTH_ERRORS,
    }
}

fn create(request: &'static str, response: &'static str) -> Contract {
    Contract {
        request: Some(request),
        response: Some((response, false)),
        success_status: "201",
        query: &[],
        errors: AUTH_ERRORS,
    }
}

fn json(response: &'static str) -> Contract {
    Contract {
        request: None,
        response: Some((response, false)),
        success_status: "200",
        query: &[],
        errors: AUTH_ERRORS,
    }
}

fn no_content() -> Contract {
    Contract {
        request: None,
        response: None,
        success_status: "204",
        query: &[],
        errors: AUTH_ERRORS,
    }
}

fn schema_ref(name: &str) -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
    Ref::new(format!("#/components/schemas/{name}")).into()
}

fn json_content(name: &str, array: bool) -> utoipa::openapi::Content {
    let schema = if array {
        ArrayBuilder::new().items(schema_ref(name)).build().into()
    } else {
        schema_ref(name)
    };
    ContentBuilder::new().schema(Some(schema)).build()
}

fn json_request(name: &str) -> utoipa::openapi::request_body::RequestBody {
    RequestBodyBuilder::new()
        .required(Some(Required::True))
        .content("application/json", json_content(name, false))
        .build()
}

fn operation(operation_id: &str, path: &str) -> utoipa::openapi::path::Operation {
    let details = contract(operation_id);
    let mut operation = OperationBuilder::new().operation_id(Some(operation_id));
    for parameter in path
        .split('/')
        .filter_map(|segment| segment.strip_prefix('{'))
    {
        let Some(name) = parameter.strip_suffix('}') else {
            continue;
        };
        operation = operation.parameter(
            ParameterBuilder::new()
                .name(name)
                .parameter_in(ParameterIn::Path)
                .required(Required::True)
                .schema(Some(ObjectBuilder::new().schema_type(Type::String).build()))
                .build(),
        );
    }
    for name in details.query {
        operation = operation.parameter(
            ParameterBuilder::new()
                .name(*name)
                .parameter_in(ParameterIn::Query)
                .required(Required::False)
                .schema(Some(ObjectBuilder::new().schema_type(Type::String).build()))
                .build(),
        );
    }
    if let Some(request) = details.request {
        operation = operation.request_body(Some(json_request(request)));
    }
    let mut responses = ResponsesBuilder::new();
    if let Some((response, array)) = details.response {
        responses = responses.response(
            details.success_status,
            ResponseBuilder::new()
                .description("Successful response")
                .content("application/json", json_content(response, array))
                .build(),
        );
    } else {
        responses = responses.response(
            details.success_status,
            ResponseBuilder::new()
                .description("Successful response")
                .build(),
        );
    }
    for status in details.errors {
        responses = responses.response(
            *status,
            ResponseBuilder::new()
                .description(error_description(status))
                .content("application/json", json_content("ErrorEnvelope", false))
                .build(),
        );
    }
    operation.responses(responses.build()).build()
}

fn error_description(status: &str) -> &'static str {
    match status {
        "401" => "Authentication required",
        "403" => "Request forbidden",
        "404" => "Resource not found",
        "409" => "Request conflicts with current state",
        "422" => "Validation error",
        "429" => "Rate limit exceeded",
        "503" => "Service unavailable",
        _ => "Request failed",
    }
}

fn paths() -> utoipa::openapi::Paths {
    let routes = [
        ("/api/v1/auth/register", HttpMethod::Post, "register"),
        (
            "/api/v1/auth/verify-email",
            HttpMethod::Post,
            "verify_email",
        ),
        (
            "/api/v1/auth/verification/resend",
            HttpMethod::Post,
            "resend_verification",
        ),
        ("/api/v1/auth/login", HttpMethod::Post, "login"),
        ("/api/v1/auth/logout", HttpMethod::Post, "logout"),
        (
            "/api/v1/auth/sessions/current",
            HttpMethod::Get,
            "current_session",
        ),
        (
            "/api/v1/auth/sessions/revoke-all",
            HttpMethod::Post,
            "revoke_all_sessions",
        ),
        (
            "/api/v1/auth/password-reset/request",
            HttpMethod::Post,
            "request_password_reset",
        ),
        (
            "/api/v1/auth/password-reset/consume",
            HttpMethod::Post,
            "consume_password_reset",
        ),
        ("/api/v1/onboarding", HttpMethod::Get, "get_onboarding"),
        (
            "/api/v1/onboarding/seed-categories",
            HttpMethod::Post,
            "seed_onboarding_categories",
        ),
        (
            "/api/v1/settings/preferences",
            HttpMethod::Put,
            "update_preferences",
        ),
        (
            "/api/v1/account/deletion",
            HttpMethod::Get,
            "get_account_deletion",
        ),
        (
            "/api/v1/account/deletion",
            HttpMethod::Post,
            "request_account_deletion",
        ),
        (
            "/api/v1/account/deletion/cancel",
            HttpMethod::Post,
            "cancel_account_deletion",
        ),
        ("/api/v1/currencies", HttpMethod::Get, "list_currencies"),
        ("/api/v1/health/live", HttpMethod::Get, "health_live"),
        ("/api/v1/health/ready", HttpMethod::Get, "health_ready"),
        ("/api/v1/wallets", HttpMethod::Get, "list_wallets"),
        ("/api/v1/wallets", HttpMethod::Post, "create_wallet"),
        ("/api/v1/wallets/{wallet_id}", HttpMethod::Get, "get_wallet"),
        (
            "/api/v1/wallets/{wallet_id}",
            HttpMethod::Patch,
            "update_wallet",
        ),
        (
            "/api/v1/wallets/{wallet_id}",
            HttpMethod::Delete,
            "delete_wallet",
        ),
        (
            "/api/v1/wallets/{wallet_id}/archive",
            HttpMethod::Post,
            "archive_wallet",
        ),
        (
            "/api/v1/wallets/{wallet_id}/restore",
            HttpMethod::Post,
            "restore_wallet",
        ),
        ("/api/v1/categories", HttpMethod::Get, "list_categories"),
        ("/api/v1/categories", HttpMethod::Post, "create_category"),
        (
            "/api/v1/categories/{category_id}",
            HttpMethod::Get,
            "get_category",
        ),
        (
            "/api/v1/categories/{category_id}",
            HttpMethod::Patch,
            "update_category",
        ),
        (
            "/api/v1/categories/{category_id}",
            HttpMethod::Delete,
            "delete_category",
        ),
        (
            "/api/v1/categories/{category_id}/archive",
            HttpMethod::Post,
            "archive_category",
        ),
        (
            "/api/v1/categories/{category_id}/restore",
            HttpMethod::Post,
            "restore_category",
        ),
        ("/api/v1/budgets", HttpMethod::Get, "list_budgets"),
        ("/api/v1/budgets", HttpMethod::Post, "create_budget"),
        (
            "/api/v1/budgets/{budget_id}",
            HttpMethod::Patch,
            "update_budget",
        ),
        (
            "/api/v1/budgets/{budget_id}",
            HttpMethod::Delete,
            "delete_budget",
        ),
        (
            "/api/v1/reports/budget-summary",
            HttpMethod::Get,
            "get_budget_summary",
        ),
        (
            "/api/v1/transactions/entry-defaults",
            HttpMethod::Get,
            "get_transaction_entry_defaults",
        ),
        ("/api/v1/transactions", HttpMethod::Get, "list_transactions"),
        (
            "/api/v1/transactions",
            HttpMethod::Post,
            "create_transaction",
        ),
        (
            "/api/v1/transactions/trash",
            HttpMethod::Get,
            "list_trashed_transactions",
        ),
        (
            "/api/v1/transactions/{transaction_id}",
            HttpMethod::Get,
            "get_transaction",
        ),
        (
            "/api/v1/transactions/{transaction_id}",
            HttpMethod::Patch,
            "update_transaction",
        ),
        (
            "/api/v1/transactions/{transaction_id}",
            HttpMethod::Delete,
            "trash_transaction",
        ),
        (
            "/api/v1/transactions/{transaction_id}/restore",
            HttpMethod::Post,
            "restore_transaction",
        ),
        (
            "/api/v1/transactions/{transaction_id}/permanent",
            HttpMethod::Delete,
            "permanently_delete_transaction",
        ),
        (
            "/api/v1/recurring-transactions",
            HttpMethod::Get,
            "list_recurring_transactions",
        ),
        (
            "/api/v1/recurring-transactions",
            HttpMethod::Post,
            "create_recurring_transaction",
        ),
        (
            "/api/v1/recurring-transactions/{id}",
            HttpMethod::Get,
            "get_recurring_transaction",
        ),
        (
            "/api/v1/recurring-transactions/{id}",
            HttpMethod::Patch,
            "update_recurring_transaction",
        ),
        (
            "/api/v1/recurring-transactions/{id}",
            HttpMethod::Delete,
            "delete_recurring_transaction",
        ),
        (
            "/api/v1/recurring-transactions/{id}/pause",
            HttpMethod::Post,
            "pause_recurring_transaction",
        ),
        (
            "/api/v1/recurring-transactions/{id}/resume",
            HttpMethod::Post,
            "resume_recurring_transaction",
        ),
        (
            "/api/v1/reports/monthly-summary",
            HttpMethod::Get,
            "get_monthly_summary",
        ),
        (
            "/api/v1/transactions/recent",
            HttpMethod::Get,
            "get_recent_transactions",
        ),
    ];

    let paths = routes
        .into_iter()
        .fold(PathsBuilder::new(), |paths, (path, method, id)| {
            paths.path(path, PathItem::new(method, operation(id, path)))
        });
    paths.build()
}
