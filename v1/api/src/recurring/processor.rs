use chrono::{Datelike, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

use super::{Cadence, next_due};

#[derive(Clone)]
pub struct RecurringProcessor {
    pool: PgPool,
}
#[derive(Clone, Copy, Debug)]
pub struct ProcessOptions {
    pub batch_size: u64,
    pub max_occurrences_per_recurring_transaction: u64,
}
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ProcessResult {
    pub generated: u64,
}
#[derive(Debug, Error)]
pub enum ProcessorError {
    #[error("recurring processor persistence failed")]
    Persistence,
}
impl RecurringProcessor {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
    pub async fn process(&self, options: ProcessOptions) -> Result<ProcessResult, ProcessorError> {
        if options.batch_size == 0 || options.max_occurrences_per_recurring_transaction == 0 {
            return Ok(ProcessResult::default());
        }
        let mut total = 0;
        let mut claimed = Vec::<Uuid>::new();
        while total < options.batch_size {
            let mut db = self
                .pool
                .begin()
                .await
                .map_err(|_| ProcessorError::Persistence)?;
            let rule: Option<DueRule> = sqlx::query_as(
                "SELECT r.id,r.user_id,r.wallet_id,r.category_id,r.transaction_type::TEXT AS transaction_type,r.amount,r.note,r.frequency::TEXT AS frequency,r.start_date,r.next_due_date,u.timezone FROM recurring_transactions r JOIN users u ON u.id=r.user_id JOIN wallets w ON (w.user_id,w.id)=(r.user_id,r.wallet_id) JOIN categories c ON (c.user_id,c.id)=(r.user_id,r.category_id) WHERE r.status='active' AND w.archived_at IS NULL AND c.archived_at IS NULL AND r.next_due_date <= (CURRENT_TIMESTAMP AT TIME ZONE u.timezone)::DATE AND NOT (r.id = ANY($1)) ORDER BY r.next_due_date,r.id LIMIT 1 FOR UPDATE OF r,w,c SKIP LOCKED")
                .bind(&claimed).fetch_optional(&mut *db).await.map_err(|_| ProcessorError::Persistence)?;
            let Some(rule) = rule else {
                db.commit().await.map_err(|_| ProcessorError::Persistence)?;
                break;
            };
            claimed.push(rule.id);
            let cadence =
                Cadence::from_database(&rule.frequency).map_err(|_| ProcessorError::Persistence)?;
            let today = local_today(&rule.timezone)?;
            let mut due = rule.next_due_date;
            let mut count = 0;
            while due <= today
                && count < options.max_occurrences_per_recurring_transaction
                && total < options.batch_size
            {
                let occurrence: Uuid = sqlx::query_scalar("WITH inserted AS (INSERT INTO recurring_occurrences (user_id,recurring_transaction_id,scheduled_for) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id) SELECT id FROM inserted UNION ALL SELECT id FROM recurring_occurrences WHERE recurring_transaction_id=$2 AND scheduled_for=$3 LIMIT 1")
                    .bind(rule.user_id).bind(rule.id).bind(due).fetch_one(&mut *db).await.map_err(|_| ProcessorError::Persistence)?;
                let inserted: Option<Uuid> = sqlx::query_scalar("INSERT INTO transactions (user_id,wallet_id,category_id,transaction_type,amount,occurred_at,note,recurring_occurrence_id) VALUES ($1,$2,$3,$4::transaction_type,$5,$6,$7,$8) ON CONFLICT (recurring_occurrence_id) DO NOTHING RETURNING id")
                    .bind(rule.user_id).bind(rule.wallet_id).bind(rule.category_id).bind(&rule.transaction_type).bind(rule.amount).bind(local_midnight(&rule.timezone,due)?).bind(&rule.note).bind(occurrence).fetch_optional(&mut *db).await.map_err(|_| ProcessorError::Persistence)?;
                due = next_due(due, rule.start_date.day(), cadence);
                sqlx::query("UPDATE recurring_transactions SET next_due_date=$3,updated_at=now() WHERE user_id=$1 AND id=$2").bind(rule.user_id).bind(rule.id).bind(due).execute(&mut *db).await.map_err(|_| ProcessorError::Persistence)?;
                count += 1;
                total += u64::from(inserted.is_some());
            }
            db.commit().await.map_err(|_| ProcessorError::Persistence)?;
        }
        Ok(ProcessResult { generated: total })
    }
}
#[derive(FromRow)]
struct DueRule {
    id: Uuid,
    user_id: Uuid,
    wallet_id: Uuid,
    category_id: Uuid,
    transaction_type: String,
    amount: rust_decimal::Decimal,
    note: Option<String>,
    frequency: String,
    start_date: NaiveDate,
    next_due_date: NaiveDate,
    timezone: String,
}
fn local_today(timezone: &str) -> Result<NaiveDate, ProcessorError> {
    let tz: Tz = timezone.parse().map_err(|_| ProcessorError::Persistence)?;
    Ok(Utc::now().with_timezone(&tz).date_naive())
}
fn local_midnight(
    timezone: &str,
    date: NaiveDate,
) -> Result<chrono::DateTime<Utc>, ProcessorError> {
    let tz: Tz = timezone.parse().map_err(|_| ProcessorError::Persistence)?;
    let value = date
        .and_hms_opt(0, 0, 0)
        .ok_or(ProcessorError::Persistence)?;
    match tz.from_local_datetime(&value) {
        LocalResult::Single(value) | LocalResult::Ambiguous(value, _) => {
            Ok(value.with_timezone(&Utc))
        }
        LocalResult::None => Err(ProcessorError::Persistence),
    }
}
