//! Create and currency HTTP boundary contract tests.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use cashmemo_application::authorization::{AuthenticatedOwner, SessionValidator};
use cashmemo_application::use_cases::create_money_memo::{CreateMoneyMemo, CreateMoneyMemoResult};
use cashmemo_domain::create::CreateCandidate;
use cashmemo_domain::label::LabelState;
use cashmemo_domain::lifecycle::Lifecycle;
use cashmemo_domain::money::{Currency, Money};
use cashmemo_domain::money_memo::{LabelReference, MoneyMemoType, PlannedStatus, Purpose};
use cashmemo_domain::occurrence::{LocalWall, Occurrence, UtcOffset, ZoneResolution};
use cashmemo_domain::{
    CreationId, DomainError, ErrorCode, FieldViolation, LabelId, MoneyMemo, MoneyMemoId, OwnerId,
    Revision, Timestamp,
};
use cashmemo_http_adapter::{AppState, build_router};
use tower::ServiceExt;

fn must<T, E>(result: Result<T, E>) -> T {
    let Ok(value) = result else {
        panic!("expected success")
    };
    value
}

struct Session;

#[async_trait]
impl SessionValidator for Session {
    async fn validate(&self, _session: &str) -> Result<AuthenticatedOwner, DomainError> {
        Ok(AuthenticatedOwner::after_account_validation(
            OwnerId::parse_authenticated_account("owner-a")?,
        ))
    }
}

#[derive(Clone)]
enum Outcome {
    Success,
    Retry,
    Privacy,
    Conflict,
    Unavailable,
}

struct Creator(Outcome);

#[async_trait]
impl CreateMoneyMemo for Creator {
    async fn create(
        &self,
        owner: &AuthenticatedOwner,
        _candidate: CreateCandidate,
    ) -> Result<CreateMoneyMemoResult, DomainError> {
        match self.0 {
            Outcome::Success => Ok(CreateMoneyMemoResult {
                memo: memo(owner.id().clone()),
                created: true,
            }),
            Outcome::Retry => Ok(CreateMoneyMemoResult {
                memo: memo(owner.id().clone()),
                created: false,
            }),
            Outcome::Privacy => Err(DomainError {
                code: ErrorCode::PrivacyInputRejected,
                message: "free-text input must be corrected",
                retryable: false,
                violations: vec![FieldViolation {
                    field: "note",
                    rule: "pattern_set_v1_block",
                    message: "Remove prohibited data before submitting.",
                    detector_id: Some("B1_PAN_LUHN"),
                }],
                existing_memo_id: None,
            }),
            Outcome::Conflict => Err(DomainError::safe(
                ErrorCode::CreationIdentifierConflict,
                "creation identifier already belongs to different input",
            )
            .with_existing_memo(memo(owner.id().clone()).id)),
            Outcome::Unavailable => Err(DomainError::retryable(
                ErrorCode::IdempotencyVerificationUnavailable,
                "idempotency verification unavailable",
            )),
        }
    }
}

fn memo(owner: OwnerId) -> MoneyMemo {
    let instant = must(Timestamp::parse_canonical("2026-07-30T12:15:00.000000Z"));
    let occurrence = must(Occurrence::new(
        instant,
        must(LocalWall::parse("2026-07-30T19:15:00.000000")),
        must(UtcOffset::parse("+07:00")),
        ZoneResolution::Unique,
    ));
    MoneyMemo {
        id: must(MoneyMemoId::parse("f5b77e8f-ae9a-466e-8df4-b0079825f46e")),
        owner,
        creation_id: must(CreationId::parse("b4f82dc9-118f-45e4-bbe7-d742f921589f")),
        memo_type: MoneyMemoType::Expense,
        money: must(Money::parse("42.50", must(Currency::parse("USD")))),
        occurrence,
        category: LabelReference {
            id: must(LabelId::parse("66ff6d25-01b0-4442-a9fe-0c4fef1f0605")),
            name: "General".to_owned(),
            state: LabelState::Active,
        },
        money_space: LabelReference {
            id: must(LabelId::parse("9074bd6a-6959-463a-8a04-88a537d12d57")),
            name: "Personal".to_owned(),
            state: LabelState::Active,
        },
        note: None,
        planned_status: PlannedStatus::Unplanned,
        purpose: Purpose::Personal,
        lifecycle: Lifecycle::ACTIVE,
        revision: Revision::INITIAL,
        created_at: instant,
        updated_at: instant,
    }
}

fn payload(note: Option<&str>) -> String {
    serde_json::json!({
        "creationId": "b4f82dc9-118f-45e4-bbe7-d742f921589f",
        "type": "expense",
        "amount": "42.50",
        "currency": "USD",
        "occurrence": {
            "instant": "2026-07-30T12:15:00.000000Z",
            "localWallTime": "2026-07-30T19:15:00.000000",
            "utcOffset": "+07:00"
        },
        "categoryId": "66ff6d25-01b0-4442-a9fe-0c4fef1f0605",
        "moneySpaceId": "9074bd6a-6959-463a-8a04-88a537d12d57",
        "note": note,
        "plannedStatus": "unplanned",
        "purpose": "personal"
    })
    .to_string()
}

#[tokio::test]
async fn create_returns_contract_exact_201_and_no_store() {
    let app = build_router(
        AppState::new(Arc::new(Session))
            .with_money_memo_creator(Arc::new(Creator(Outcome::Success))),
    );
    let response = app
        .oneshot(
            Request::post("/api/v1/money-memos")
                .header("cookie", "cashmemo_session=opaque")
                .header("content-type", "application/json")
                .body(Body::from(payload(None)))
                .unwrap_or_else(|_| panic!("request build failed")),
        )
        .await
        .unwrap_or_else(|_| panic!("router failed"));
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = must(to_bytes(response.into_body(), 64 * 1024).await);
    let value: serde_json::Value = must(serde_json::from_slice(&body));
    assert_eq!(value["amount"], "42.50");
    assert_eq!(
        value["occurrence"]["instant"],
        "2026-07-30T12:15:00.000000Z"
    );
    assert!(value["purgeDeadline"].is_null());
}

#[tokio::test]
async fn privacy_422_exposes_safe_identifier_only_and_never_candidate() {
    let app = build_router(
        AppState::new(Arc::new(Session))
            .with_money_memo_creator(Arc::new(Creator(Outcome::Privacy))),
    );
    let candidate = "4111111111111111";
    let response = app
        .oneshot(
            Request::post("/api/v1/money-memos")
                .header("cookie", "cashmemo_session=opaque")
                .header("content-type", "application/json")
                .body(Body::from(payload(Some(candidate))))
                .unwrap_or_else(|_| panic!("request build failed")),
        )
        .await
        .unwrap_or_else(|_| panic!("router failed"));
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = must(to_bytes(response.into_body(), 64 * 1024).await);
    let text = must(String::from_utf8(body.to_vec()));
    assert!(text.contains("PRIVACY_INPUT_REJECTED"));
    assert!(text.contains("B1_PAN_LUHN"));
    assert!(!text.contains(candidate));
    assert!(!text.contains("4111"));
}

#[tokio::test]
async fn retry_conflict_and_key_failure_use_stable_status_and_safe_shape() {
    for (outcome, expected, code) in [
        (Outcome::Retry, StatusCode::OK, None),
        (
            Outcome::Conflict,
            StatusCode::CONFLICT,
            Some("CREATION_IDENTIFIER_CONFLICT"),
        ),
        (
            Outcome::Unavailable,
            StatusCode::SERVICE_UNAVAILABLE,
            Some("IDEMPOTENCY_VERIFICATION_UNAVAILABLE"),
        ),
    ] {
        let app = build_router(
            AppState::new(Arc::new(Session)).with_money_memo_creator(Arc::new(Creator(outcome))),
        );
        let response = app
            .oneshot(must(
                Request::post("/api/v1/money-memos")
                    .header("cookie", "cashmemo_session=opaque")
                    .header("content-type", "application/json")
                    .body(Body::from(payload(None))),
            ))
            .await;
        let response = must(response);
        assert_eq!(response.status(), expected);
        assert_eq!(response.headers()["cache-control"], "no-store");
        if let Some(code) = code {
            let body = must(to_bytes(response.into_body(), 64 * 1024).await);
            let text = must(String::from_utf8(body.to_vec()));
            assert!(text.contains(code));
            assert!(!text.contains("42.50"));
        }
    }
}

#[tokio::test]
async fn currency_registry_is_immutable_contract_projection() {
    let app = build_router(AppState::new(Arc::new(Session)));
    let response = must(
        app.oneshot(must(
            Request::get("/api/v1/reference/currencies")
                .header("cookie", "cashmemo_session=opaque")
                .body(Body::empty()),
        ))
        .await,
    );
    assert_eq!(response.status(), StatusCode::OK);
    let body = must(to_bytes(response.into_body(), 512 * 1024).await);
    let value: serde_json::Value = must(serde_json::from_slice(&body));
    assert_eq!(value["version"], "iso4217-list-one-2026-01-01");
    assert_eq!(value["sourceEffectiveDate"], "2026-01-01");
    assert!(
        value["currencies"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    );
    assert!(value["currencies"][0].get("name").is_none());
    assert!(value.get("sourceSha256").is_none());
}
