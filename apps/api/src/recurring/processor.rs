use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

use super::{Cadence, first_due_on_or_after};

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
        self.process_at(options, Utc::now()).await
    }

    pub async fn process_at(
        &self,
        options: ProcessOptions,
        now: DateTime<Utc>,
    ) -> Result<ProcessResult, ProcessorError> {
        if options.batch_size == 0 || options.max_occurrences_per_recurring_transaction == 0 {
            return Ok(ProcessResult::default());
        }
        let mut generated = 0;
        let mut decisions = 0;
        let mut claimed = Vec::<Uuid>::new();
        while decisions < options.batch_size {
            let mut db = self
                .pool
                .begin()
                .await
                .map_err(|_| ProcessorError::Persistence)?;
            let rule: Option<DueRule> = sqlx::query_as(
                "SELECT r.id,r.user_id,r.wallet_id,r.category_id,r.transaction_type::TEXT AS transaction_type,r.amount,r.note,r.frequency::TEXT AS frequency,r.start_date,r.next_due_date,u.timezone FROM recurring_transactions r JOIN users u ON u.id=r.user_id JOIN wallets w ON (w.user_id,w.id)=(r.user_id,r.wallet_id) JOIN categories c ON (c.user_id,c.id)=(r.user_id,r.category_id) WHERE r.status='active' AND w.archived_at IS NULL AND c.archived_at IS NULL AND r.next_due_date <= ($2::TIMESTAMPTZ AT TIME ZONE u.timezone)::DATE AND NOT (r.id = ANY($1)) ORDER BY r.next_due_date,r.id LIMIT 1 FOR UPDATE OF r,w,c SKIP LOCKED")
                .bind(&claimed).bind(now).fetch_optional(&mut *db).await.map_err(|_| ProcessorError::Persistence)?;
            let Some(rule) = rule else {
                db.commit().await.map_err(|_| ProcessorError::Persistence)?;
                break;
            };
            claimed.push(rule.id);
            let cadence =
                Cadence::from_database(&rule.frequency).map_err(|_| ProcessorError::Persistence)?;
            let today = local_today(&rule.timezone, now)?;
            let mut due = rule.next_due_date;
            let mut count = 0;
            while due <= today
                && count < options.max_occurrences_per_recurring_transaction
                && decisions < options.batch_size
            {
                let occurrence: Option<Uuid> = sqlx::query_scalar("INSERT INTO recurring_occurrences (user_id,recurring_transaction_id,scheduled_for) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id")
                    .bind(rule.user_id).bind(rule.id).bind(due).fetch_optional(&mut *db).await.map_err(|_| ProcessorError::Persistence)?;
                let inserted: Option<Uuid> = if let Some(occurrence) = occurrence {
                    sqlx::query_scalar("INSERT INTO transactions (user_id,wallet_id,category_id,transaction_type,amount,occurred_at,note,recurring_occurrence_id) VALUES ($1,$2,$3,$4::transaction_type,$5,$6,$7,$8) ON CONFLICT (recurring_occurrence_id) DO NOTHING RETURNING id")
                        .bind(rule.user_id).bind(rule.wallet_id).bind(rule.category_id).bind(&rule.transaction_type).bind(rule.amount).bind(local_midnight(&rule.timezone,due)?).bind(&rule.note).bind(occurrence).fetch_optional(&mut *db).await.map_err(|_| ProcessorError::Persistence)?
                } else {
                    None
                };
                due = first_due_on_or_after(
                    rule.start_date,
                    due.succ_opt().expect("valid date has successor"),
                    cadence,
                );
                sqlx::query("UPDATE recurring_transactions SET next_due_date=$3,updated_at=now() WHERE user_id=$1 AND id=$2").bind(rule.user_id).bind(rule.id).bind(due).execute(&mut *db).await.map_err(|_| ProcessorError::Persistence)?;
                count += 1;
                decisions += 1;
                generated += u64::from(inserted.is_some());
            }
            db.commit().await.map_err(|_| ProcessorError::Persistence)?;
        }
        Ok(ProcessResult { generated })
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
fn local_today(timezone: &str, now: DateTime<Utc>) -> Result<NaiveDate, ProcessorError> {
    let tz: Tz = timezone.parse().map_err(|_| ProcessorError::Persistence)?;
    Ok(now.with_timezone(&tz).date_naive())
}
fn local_midnight(
    timezone: &str,
    date: NaiveDate,
) -> Result<chrono::DateTime<Utc>, ProcessorError> {
    let tz: Tz = timezone.parse().map_err(|_| ProcessorError::Persistence)?;
    let value = date
        .and_hms_opt(0, 0, 0)
        .ok_or(ProcessorError::Persistence)?;
    resolve_local_boundary(tz, value)
}

fn resolve_local_boundary(
    tz: Tz,
    requested: NaiveDateTime,
) -> Result<chrono::DateTime<Utc>, ProcessorError> {
    match tz.from_local_datetime(&requested) {
        LocalResult::Single(value) | LocalResult::Ambiguous(value, _) => {
            Ok(value.with_timezone(&Utc))
        }
        LocalResult::None => resolve_nonexistent_local_boundary(tz, requested),
    }
}

fn resolve_nonexistent_local_boundary(
    tz: Tz,
    requested: NaiveDateTime,
) -> Result<chrono::DateTime<Utc>, ProcessorError> {
    let mut missing = 0_i64;
    let mut valid = 1_i64;
    while matches!(
        tz.from_local_datetime(&add_seconds(requested, valid)?),
        LocalResult::None
    ) {
        missing = valid;
        valid = valid
            .checked_mul(2)
            .filter(|value| *value <= 172_800)
            .ok_or(ProcessorError::Persistence)?;
    }
    while valid - missing > 1 {
        let middle = missing + (valid - missing) / 2;
        if matches!(
            tz.from_local_datetime(&add_seconds(requested, middle)?),
            LocalResult::None
        ) {
            missing = middle;
        } else {
            valid = middle;
        }
    }
    match tz.from_local_datetime(&add_seconds(requested, valid)?) {
        LocalResult::Single(value) | LocalResult::Ambiguous(value, _) => {
            Ok(value.with_timezone(&Utc))
        }
        LocalResult::None => Err(ProcessorError::Persistence),
    }
}

fn add_seconds(value: NaiveDateTime, seconds: i64) -> Result<NaiveDateTime, ProcessorError> {
    value
        .checked_add_signed(Duration::seconds(seconds))
        .ok_or(ProcessorError::Persistence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midnight_gap_uses_earliest_valid_local_instant() {
        let timezone: Tz = "Pacific/Apia".parse().unwrap();
        let date = NaiveDate::from_ymd_opt(2011, 12, 30).unwrap();
        assert_eq!(
            local_midnight("Pacific/Apia", date).unwrap(),
            timezone
                .from_local_datetime(
                    &NaiveDate::from_ymd_opt(2011, 12, 31)
                        .unwrap()
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                )
                .single()
                .unwrap()
                .with_timezone(&Utc)
        );
    }
}
