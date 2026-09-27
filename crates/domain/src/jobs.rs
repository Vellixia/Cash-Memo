//! A small Postgres job queue: the API enqueues, apps/worker claims and runs.
// ponytail: hand-rolled with polling; move to apalis or LISTEN/NOTIFY if job kinds multiply.
use sea_orm::{ConnectionTrait, DbBackend, DbErr, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const EMAIL: &str = "email";

/// Payload of an `email` job. Scrubbed from the row once sent (it may carry a live link).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Email {
    pub to: String,
    pub subject: String,
    pub text: String,
}

pub async fn enqueue(
    db: &impl ConnectionTrait,
    kind: &str,
    payload: impl Serialize,
    user_id: Option<Uuid>,
) -> Result<Uuid, DbErr> {
    let id = Uuid::new_v4();
    let payload = serde_json::to_value(payload).map_err(|e| DbErr::Custom(e.to_string()))?;
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO jobs (id, kind, payload, user_id) VALUES ($1, $2, $3, $4)",
        [id.into(), kind.into(), payload.into(), user_id.into()],
    ))
    .await?;
    Ok(id)
}

#[derive(FromQueryResult, Debug)]
pub struct Job {
    pub id: Uuid,
    pub kind: String,
    pub payload: serde_json::Value,
    pub attempts: i32,
    pub user_id: Option<Uuid>,
}

/// Takes the oldest due job of one of `kinds`, or None. Safe with many workers (SKIP LOCKED).
pub async fn claim(db: &impl ConnectionTrait, kinds: &[&str]) -> Result<Option<Job>, DbErr> {
    let kinds: Vec<String> = kinds.iter().map(|k| k.to_string()).collect();
    Job::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
         WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() AND kind = ANY($1)
                     ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING id, kind, payload, attempts, user_id",
        [kinds.into()],
    ))
    .one(db)
    .await
}

pub async fn finish(
    db: &impl ConnectionTrait,
    id: Uuid,
    result: Option<serde_json::Value>,
    scrub_payload: bool,
) -> Result<(), DbErr> {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE jobs SET status = 'done', result = $2, locked_at = NULL, updated_at = now(),
                payload = CASE WHEN $3 THEN '{}'::jsonb ELSE payload END
         WHERE id = $1",
        [id.into(), result.into(), scrub_payload.into()],
    ))
    .await?;
    Ok(())
}

/// Retries with backoff (30s, 2m, 8m …) until `max_attempts`, then marks the job failed.
pub async fn fail(
    db: &impl ConnectionTrait,
    job: &Job,
    error: &str,
    max_attempts: i32,
) -> Result<bool, DbErr> {
    let give_up = job.attempts >= max_attempts;
    let delay = 30 * 4_i64.pow(job.attempts.clamp(1, 6) as u32 - 1);
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE jobs SET status = CASE WHEN $2 THEN 'failed' ELSE 'queued' END, error = $3,
                locked_at = NULL, updated_at = now(), run_after = now() + make_interval(secs => $4)
         WHERE id = $1",
        [
            job.id.into(),
            give_up.into(),
            error.into(),
            (delay as f64).into(),
        ],
    ))
    .await?;
    Ok(give_up)
}

/// Pushes a job back without counting an attempt (e.g. the daily email cap is reached).
pub async fn defer(db: &impl ConnectionTrait, id: Uuid, secs: i64) -> Result<(), DbErr> {
    db.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE jobs SET status = 'queued', attempts = attempts - 1, locked_at = NULL, updated_at = now(),
                run_after = now() + make_interval(secs => $2)
         WHERE id = $1",
        [id.into(), (secs as f64).into()],
    ))
    .await?;
    Ok(())
}

/// Jobs left `running` by a worker that died are put back in the queue.
pub async fn requeue_stale(db: &impl ConnectionTrait) -> Result<u64, DbErr> {
    Ok(db
        .execute_raw(Statement::from_string(
            DbBackend::Postgres,
            "UPDATE jobs SET status = 'queued', locked_at = NULL, updated_at = now()
             WHERE status = 'running' AND locked_at < now() - interval '15 minutes'",
        ))
        .await?
        .rows_affected())
}
