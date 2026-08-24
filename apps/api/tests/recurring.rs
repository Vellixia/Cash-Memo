mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use cashmemo_api::app::{AppState, build_app};
use cashmemo_api::{
    recurring::{
        Cadence, ProcessOptions, RecurringProcessor, RecurringTransactionService,
        first_due_on_or_after, next_due,
    },
    transactions::TransactionService,
};
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn creates_daily_recurring_transaction_with_first_due_date_at_or_after_today(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "recurring-create@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let app = build_app(AppState { pool: pool.clone() });
    let start_date = "2000-01-01";

    let response = app
        .oneshot(post_recurring(
            &cookie,
            json!({
                "wallet_id": wallet_id,
                "category_id": category_id,
                "direction": "expense",
                "amount": "12.50",
                "frequency": "daily",
                "start_date": start_date,
                "note": "rent"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    assert_eq!(body["wallet_id"], wallet_id.to_string());
    assert_eq!(body["category_id"], category_id.to_string());
    assert_eq!(body["direction"], "expense");
    assert_eq!(body["amount"], "12.50");
    assert_eq!(body["frequency"], "daily");
    assert_eq!(body["start_date"], start_date);
    assert_eq!(body["next_due_date"], Utc::now().date_naive().to_string());

    let occurrences: i64 = sqlx::query_scalar("SELECT count(*) FROM recurring_occurrences")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(occurrences, 0);
}

#[sqlx::test(migrations = false)]
async fn processor_creates_each_due_occurrence_once_and_bounds_catch_up(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "recurring-process@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let app = build_app(AppState { pool: pool.clone() });
    let response = app.oneshot(post_recurring(&cookie, json!({"wallet_id": wallet_id, "category_id": category_id, "direction":"expense", "amount":"12.50", "frequency":"daily", "start_date":"2000-01-01"}))).await.unwrap();
    let rule = json_body(response).await;
    let rule_id = Uuid::parse_str(rule["id"].as_str().unwrap()).unwrap();
    let today = Utc::now().date_naive();
    sqlx::query("UPDATE recurring_transactions SET next_due_date=$2 WHERE id=$1")
        .bind(rule_id)
        .bind(today - chrono::Days::new(2))
        .execute(&pool)
        .await
        .unwrap();

    let processor = RecurringProcessor::new(pool.clone());
    let first = processor
        .process(ProcessOptions {
            batch_size: 10,
            max_occurrences_per_recurring_transaction: 2,
        })
        .await
        .unwrap();
    assert_eq!(first.generated, 2);
    let second = processor
        .process(ProcessOptions {
            batch_size: 10,
            max_occurrences_per_recurring_transaction: 2,
        })
        .await
        .unwrap();
    assert_eq!(second.generated, 1);
    let third = processor
        .process(ProcessOptions {
            batch_size: 10,
            max_occurrences_per_recurring_transaction: 2,
        })
        .await
        .unwrap();
    assert_eq!(third.generated, 0);
    let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM recurring_occurrences WHERE recurring_transaction_id=$1), (SELECT count(*) FROM transactions WHERE recurring_occurrence_id IS NOT NULL)").bind(rule_id).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (3, 3));
}

#[test]
fn calendar_cadences_preserve_calendar_anchor_and_clamp_month_end_and_leap_day() {
    let jan_31 = chrono::NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
    assert_eq!(
        next_due(jan_31, 31, Cadence::Daily),
        chrono::NaiveDate::from_ymd_opt(2026, 2, 1).unwrap()
    );
    assert_eq!(
        next_due(jan_31, 31, Cadence::Weekly),
        chrono::NaiveDate::from_ymd_opt(2026, 2, 7).unwrap()
    );
    let feb = next_due(jan_31, 31, Cadence::Monthly);
    assert_eq!(feb, chrono::NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
    assert_eq!(
        next_due(feb, 31, Cadence::Monthly),
        chrono::NaiveDate::from_ymd_opt(2026, 3, 31).unwrap()
    );
    let leap = chrono::NaiveDate::from_ymd_opt(2024, 2, 29).unwrap();
    assert_eq!(
        next_due(leap, 29, Cadence::Yearly),
        chrono::NaiveDate::from_ymd_opt(2025, 2, 28).unwrap()
    );
    assert_eq!(
        next_due(
            chrono::NaiveDate::from_ymd_opt(2027, 2, 28).unwrap(),
            29,
            Cadence::Yearly
        ),
        chrono::NaiveDate::from_ymd_opt(2028, 2, 29).unwrap()
    );
    assert_eq!(
        first_due_on_or_after(
            chrono::NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
            chrono::NaiveDate::from_ymd_opt(2026, 3, 1).unwrap(),
            Cadence::Monthly
        ),
        chrono::NaiveDate::from_ymd_opt(2026, 3, 31).unwrap()
    );
}

#[sqlx::test(migrations = false)]
async fn category_archive_pauses_and_restore_does_not_resume_and_resume_blocks_archived_reference(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) =
        authenticated_user(&pool, "recurring-category-archive@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let rule_id = insert_rule(
        &pool,
        user_id,
        wallet_id,
        category_id,
        Utc::now().date_naive(),
    )
    .await;
    let app = build_app(AppState { pool: pool.clone() });
    let archive = app
        .clone()
        .oneshot(post_empty(
            &cookie,
            &format!("/api/v1/categories/{category_id}/archive"),
        ))
        .await
        .unwrap();
    assert_eq!(archive.status(), StatusCode::OK);
    assert_eq!(json_body(archive).await["paused_recurring_count"], 1);
    let resume = RecurringTransactionService::new(pool.clone())
        .resume(user_id, rule_id)
        .await;
    assert!(matches!(
        resume,
        Err(cashmemo_api::recurring::RecurringError::ArchivedCategory)
    ));
    let restore = app
        .oneshot(post_empty(
            &cookie,
            &format!("/api/v1/categories/{category_id}/restore"),
        ))
        .await
        .unwrap();
    assert_eq!(restore.status(), StatusCode::OK);
    let status: String =
        sqlx::query_scalar("SELECT status::TEXT FROM recurring_transactions WHERE id=$1")
            .bind(rule_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status, "paused");
}

#[sqlx::test(migrations = false)]
async fn permanent_deletion_keeps_occurrence_and_processor_does_not_regenerate_it(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, _cookie) = authenticated_user(&pool, "recurring-delete@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let today = Utc::now().date_naive();
    let rule_id = insert_rule(&pool, user_id, wallet_id, category_id, today).await;
    let processor = RecurringProcessor::new(pool.clone());
    processor
        .process(ProcessOptions {
            batch_size: 1,
            max_occurrences_per_recurring_transaction: 1,
        })
        .await
        .unwrap();
    let transaction_id: Uuid =
        sqlx::query_scalar("SELECT id FROM transactions WHERE recurring_occurrence_id IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    let service = TransactionService::new(pool.clone());
    service.trash(user_id, transaction_id).await.unwrap();
    service
        .permanently_delete(user_id, transaction_id)
        .await
        .unwrap();
    processor
        .process(ProcessOptions {
            batch_size: 10,
            max_occurrences_per_recurring_transaction: 10,
        })
        .await
        .unwrap();
    let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM recurring_occurrences WHERE recurring_transaction_id=$1), (SELECT count(*) FROM transactions WHERE recurring_occurrence_id IS NOT NULL)").bind(rule_id).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 0));
}

#[sqlx::test(migrations = false)]
async fn existing_occurrence_never_regenerates_after_transaction_deletion_and_due_reset(
    pool: PgPool,
) {
    support::migrate_v1(&pool).await;
    let (user_id, _cookie) =
        authenticated_user(&pool, "recurring-consumed-occurrence@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let due = Utc::now().date_naive();
    let rule_id = insert_rule(&pool, user_id, wallet_id, category_id, due).await;
    let processor = RecurringProcessor::new(pool.clone());
    processor
        .process(ProcessOptions {
            batch_size: 1,
            max_occurrences_per_recurring_transaction: 1,
        })
        .await
        .unwrap();
    let transaction_id: Uuid =
        sqlx::query_scalar("SELECT id FROM transactions WHERE recurring_occurrence_id IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
    let transactions = TransactionService::new(pool.clone());
    transactions.trash(user_id, transaction_id).await.unwrap();
    transactions
        .permanently_delete(user_id, transaction_id)
        .await
        .unwrap();
    sqlx::query("UPDATE recurring_transactions SET next_due_date=$2, updated_at=now() WHERE id=$1")
        .bind(rule_id)
        .bind(due)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        processor
            .process(ProcessOptions {
                batch_size: 1,
                max_occurrences_per_recurring_transaction: 1
            })
            .await
            .unwrap()
            .generated,
        0
    );
    let counts: (i64, i64) = sqlx::query_as("SELECT (SELECT count(*) FROM recurring_occurrences WHERE recurring_transaction_id=$1), (SELECT count(*) FROM transactions WHERE recurring_occurrence_id IS NOT NULL)").bind(rule_id).fetch_one(&pool).await.unwrap();
    assert_eq!(counts, (1, 0));
}

#[sqlx::test(migrations = false)]
async fn concurrent_processors_create_one_occurrence_and_transaction(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, _cookie) = authenticated_user(&pool, "recurring-concurrent@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let rule_id = insert_rule(
        &pool,
        user_id,
        wallet_id,
        category_id,
        Utc::now().date_naive(),
    )
    .await;
    let options = ProcessOptions {
        batch_size: 10,
        max_occurrences_per_recurring_transaction: 10,
    };
    let first = RecurringProcessor::new(pool.clone());
    let second = RecurringProcessor::new(pool.clone());
    let (left, right) = tokio::join!(first.process(options), second.process(options));
    left.unwrap();
    right.unwrap();
    let counts: (i64, i64, chrono::NaiveDate) = sqlx::query_as("SELECT (SELECT count(*) FROM recurring_occurrences WHERE recurring_transaction_id=$1), (SELECT count(*) FROM transactions WHERE recurring_occurrence_id IS NOT NULL), (SELECT next_due_date FROM recurring_transactions WHERE id=$1)").bind(rule_id).fetch_one(&pool).await.unwrap();
    assert_eq!(counts.0, 1);
    assert_eq!(counts.1, 1);
    assert_eq!(counts.2, Utc::now().date_naive() + chrono::Days::new(1));
}

#[sqlx::test(migrations = false)]
async fn past_creation_uses_users_local_today_without_backfill(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, cookie) = authenticated_user(&pool, "recurring-local-date@example.test").await;
    sqlx::query("UPDATE users SET timezone='Pacific/Kiritimati' WHERE id=$1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let app = build_app(AppState { pool: pool.clone() });
    let response = app.oneshot(post_recurring(&cookie, json!({"wallet_id":wallet_id,"category_id":category_id,"direction":"expense","amount":"1.00","frequency":"weekly","start_date":"2000-01-01"}))).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    let tz: chrono_tz::Tz = "Pacific/Kiritimati".parse().unwrap();
    let expected = first_due_on_or_after(
        chrono::NaiveDate::from_ymd_opt(2000, 1, 1).unwrap(),
        Utc::now().with_timezone(&tz).date_naive(),
        Cadence::Weekly,
    );
    assert_eq!(body["next_due_date"], expected.to_string());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM recurring_occurrences")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = false)]
async fn timezone_change_preserves_history_and_uses_new_timezone_for_new_transaction(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, _cookie) = authenticated_user(&pool, "recurring-timezone@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let old_due = Utc::now().date_naive() - chrono::Days::new(1);
    let rule_id = insert_rule(&pool, user_id, wallet_id, category_id, old_due).await;
    let processor = RecurringProcessor::new(pool.clone());
    processor
        .process(ProcessOptions {
            batch_size: 1,
            max_occurrences_per_recurring_transaction: 1,
        })
        .await
        .unwrap();
    let old_occurred: chrono::DateTime<Utc> = sqlx::query_scalar(
        "SELECT occurred_at FROM transactions WHERE recurring_occurrence_id IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE users SET timezone='Pacific/Kiritimati' WHERE id=$1")
        .bind(user_id)
        .execute(&pool)
        .await
        .unwrap();
    processor
        .process(ProcessOptions {
            batch_size: 1,
            max_occurrences_per_recurring_transaction: 1,
        })
        .await
        .unwrap();
    let values: Vec<chrono::DateTime<Utc>> = sqlx::query_scalar("SELECT occurred_at FROM transactions WHERE recurring_occurrence_id IS NOT NULL ORDER BY occurred_at").fetch_all(&pool).await.unwrap();
    assert_eq!(values.len(), 2);
    assert!(values.contains(&old_occurred));
    let scheduled: chrono::NaiveDate = sqlx::query_scalar("SELECT scheduled_for FROM recurring_occurrences WHERE recurring_transaction_id=$1 ORDER BY scheduled_for DESC LIMIT 1").bind(rule_id).fetch_one(&pool).await.unwrap();
    let tz: chrono_tz::Tz = "Pacific/Kiritimati".parse().unwrap();
    let expected = tz
        .from_local_datetime(&scheduled.and_hms_opt(0, 0, 0).unwrap())
        .single()
        .unwrap()
        .with_timezone(&Utc);
    assert_eq!(*values.iter().max().unwrap(), expected);
}

#[sqlx::test(migrations = false)]
async fn paused_rule_is_absent_from_history_until_generation(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (user_id, _cookie) = authenticated_user(&pool, "recurring-paused@example.test").await;
    let (wallet_id, category_id) = owned_references(&pool, user_id).await;
    let rule_id = insert_rule(
        &pool,
        user_id,
        wallet_id,
        category_id,
        Utc::now().date_naive(),
    )
    .await;
    sqlx::query("UPDATE recurring_transactions SET status='paused' WHERE id=$1")
        .bind(rule_id)
        .execute(&pool)
        .await
        .unwrap();
    let processor = RecurringProcessor::new(pool.clone());
    assert_eq!(
        processor
            .process(ProcessOptions {
                batch_size: 10,
                max_occurrences_per_recurring_transaction: 10
            })
            .await
            .unwrap()
            .generated,
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM transactions")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    sqlx::query("UPDATE recurring_transactions SET status='active' WHERE id=$1")
        .bind(rule_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        processor
            .process(ProcessOptions {
                batch_size: 10,
                max_occurrences_per_recurring_transaction: 10
            })
            .await
            .unwrap()
            .generated,
        1
    );
    let query = cashmemo_api::transactions::RawHistoryQuery {
        from: None,
        to: None,
        transaction_type: None,
        wallet_id: None,
        category_id: None,
        q: None,
        cursor: None,
        limit: None,
    }
    .parse()
    .unwrap();
    assert_eq!(
        TransactionService::new(pool.clone())
            .history(user_id, query, false)
            .await
            .unwrap()
            .items
            .len(),
        1
    );
}

#[sqlx::test(migrations = false)]
async fn midnight_gap_rule_and_later_due_rule_both_process(pool: PgPool) {
    support::migrate_v1(&pool).await;
    let (gap_user, _gap_cookie) =
        authenticated_user(&pool, "recurring-apia-gap@example.test").await;
    let (later_user, _later_cookie) =
        authenticated_user(&pool, "recurring-later-rule@example.test").await;
    sqlx::query("UPDATE users SET timezone='Pacific/Apia' WHERE id=$1")
        .bind(gap_user)
        .execute(&pool)
        .await
        .unwrap();
    let (gap_wallet, gap_category) = owned_references(&pool, gap_user).await;
    let (later_wallet, later_category) = owned_references(&pool, later_user).await;
    let gap_date = chrono::NaiveDate::from_ymd_opt(2011, 12, 30).unwrap();
    let later_date = chrono::NaiveDate::from_ymd_opt(2011, 12, 31).unwrap();
    insert_rule(&pool, gap_user, gap_wallet, gap_category, gap_date).await;
    insert_rule(&pool, later_user, later_wallet, later_category, later_date).await;
    let now = chrono::DateTime::parse_from_rfc3339("2011-12-31T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    assert_eq!(
        RecurringProcessor::new(pool.clone())
            .process_at(
                ProcessOptions {
                    batch_size: 10,
                    max_occurrences_per_recurring_transaction: 1
                },
                now
            )
            .await
            .unwrap()
            .generated,
        2
    );
    let rows: Vec<(Uuid, chrono::DateTime<Utc>)> = sqlx::query_as("SELECT user_id, occurred_at FROM transactions WHERE recurring_occurrence_id IS NOT NULL ORDER BY user_id").fetch_all(&pool).await.unwrap();
    assert_eq!(rows.len(), 2);
    let apia_time = rows
        .iter()
        .find(|(user_id, _)| *user_id == gap_user)
        .unwrap()
        .1;
    assert_eq!(
        apia_time,
        chrono::DateTime::parse_from_rfc3339("2011-12-30T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    );
    assert!(rows.iter().any(|(user_id, _)| *user_id == later_user));
}

async fn insert_rule(
    pool: &PgPool,
    user_id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    due: chrono::NaiveDate,
) -> Uuid {
    sqlx::query_scalar("INSERT INTO recurring_transactions (user_id,wallet_id,category_id,transaction_type,amount,frequency,start_date,next_due_date) VALUES ($1,$2,$3,'EXPENSE',1,'daily',$4,$4) RETURNING id").bind(user_id).bind(wallet_id).bind(category_id).bind(due).fetch_one(pool).await.unwrap()
}

fn post_empty(cookie: &str, uri: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .body(Body::empty())
        .unwrap()
}

async fn authenticated_user(pool: &PgPool, email: &str) -> (Uuid, String) {
    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, status, email_verified, timezone)
         VALUES ($1, $2, 'hash', 'active', TRUE, 'Etc/UTC')",
    )
    .bind(user_id)
    .bind(email)
    .execute(pool)
    .await
    .unwrap();
    let raw_token = format!("test-token-{user_id}");
    let token_hash = format!("{:x}", Sha256::digest(raw_token.as_bytes()));
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + INTERVAL '1 day')",
    )
    .bind(user_id)
    .bind(token_hash)
    .execute(pool)
    .await
    .unwrap();
    (user_id, format!("__Host-cashmemo_session={raw_token}"))
}

async fn owned_references(pool: &PgPool, user_id: Uuid) -> (Uuid, Uuid) {
    let wallet_id: Uuid = sqlx::query_scalar(
        "INSERT INTO wallets (user_id, name, currency_code, opening_balance)
         VALUES ($1, 'Main', 'USD', 0) RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let category_id: Uuid = sqlx::query_scalar(
        "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
         VALUES ($1, 'Bills', 'bills', 'EXPENSE') RETURNING id",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap();
    (wallet_id, category_id)
}

fn post_recurring(cookie: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/api/v1/recurring-transactions")
        .header(header::COOKIE, cookie)
        .header(header::ORIGIN, "http://localhost:3000")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}
