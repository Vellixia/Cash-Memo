//! Rust-owned OpenAPI contract for V1.
//!
//! Route handlers stay in their feature modules. This module owns the public contract so
//! exporting the document never depends on database state or runtime configuration.

use std::collections::BTreeMap;

use serde::Serialize;
use utoipa::ToSchema;
use utoipa::openapi::{
    ComponentsBuilder, Info, OpenApiBuilder, PathItem, PathsBuilder, Required,
    path::{HttpMethod, OperationBuilder, ParameterBuilder, ParameterIn},
    response::{ResponseBuilder, ResponsesBuilder},
    schema::{ObjectBuilder, Type},
};
use uuid::Uuid;

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
pub struct RecurringTransactionContract {
    pub id: Uuid,
    pub recurring_transaction_id: Uuid,
    pub recurring_occurrence_id: Option<Uuid>,
    pub wallet_id: Uuid,
    pub category_id: Uuid,
    pub direction: String,
    pub amount: String,
    pub currency: String,
    pub note: Option<String>,
    pub frequency: String,
    pub start_date: String,
    pub next_due_date: String,
    pub status: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecurringTransactionsContract {
    pub recurring_transactions: Vec<RecurringTransactionContract>,
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
    pub default_currency_configured: bool,
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
pub struct CredentialsContract {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EmailContract {
    pub email: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TokenContract {
    pub token: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PreferencesContract {
    pub timezone: String,
    pub default_currency_code: String,
}

/// Complete deterministic V1 contract.
pub struct ApiDoc;

impl ApiDoc {
    pub fn openapi() -> utoipa::openapi::OpenApi {
        let components = ComponentsBuilder::new()
            .schema_from::<ErrorBody>()
            .schema_from::<ErrorEnvelope>()
            .schema_from::<EntryDefaults>()
            .schema_from::<RecurringTransactionContract>()
            .schema_from::<RecurringTransactionsContract>()
            .schema_from::<TransactionContract>()
            .schema_from::<WalletContract>()
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
            .schema_from::<CredentialsContract>()
            .schema_from::<EmailContract>()
            .schema_from::<TokenContract>()
            .schema_from::<PreferencesContract>()
            .build();

        OpenApiBuilder::new()
            .info(Info::new("Cashmemo V1 API", "1.0.0"))
            .paths(paths())
            .components(Some(components))
            .build()
    }
}

fn operation(operation_id: &str, path: &str) -> utoipa::openapi::path::Operation {
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
    operation
        .responses(
            ResponsesBuilder::new()
                .response(
                    "200",
                    ResponseBuilder::new()
                        .description("Successful response")
                        .build(),
                )
                .response(
                    "422",
                    ResponseBuilder::new()
                        .description("Validation error")
                        .build(),
                )
                .response(
                    "500",
                    ResponseBuilder::new()
                        .description("Internal server error")
                        .build(),
                )
                .build(),
        )
        .build()
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
