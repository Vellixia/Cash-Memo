//! Data ownership: CSV export and import. The API only queues work and hands out short-lived
//! storage links; apps/worker does the heavy lifting on its own small DB pool.
use std::time::Duration;

use axum::{
    Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use domain::{
    import::Mapping,
    jobs::{self, CommitPayload, ExportPayload, ValidatePayload},
};
use sea_orm::{ConnectionTrait, DbBackend, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    error::{AppError, Json, Path, Result},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/exports", post(start_export))
        .route("/imports", post(start_upload))
        .route("/imports/{id}/validate", post(validate))
        .route("/imports/{id}/commit", post(commit))
        .route("/jobs/{id}", get(job))
}

#[derive(Deserialize)]
struct ExportIn {
    #[serde(default)]
    offset: i32,
}

#[derive(Serialize)]
struct Queued {
    job_id: Uuid,
}

#[derive(Serialize)]
struct UploadOut {
    import_id: Uuid,
    /// PUT the CSV file here (valid 15 minutes).
    upload_url: String,
}

#[derive(Deserialize)]
struct ValidateIn {
    mapping: Mapping,
}

#[derive(Serialize, FromQueryResult)]
struct JobOut {
    id: Uuid,
    kind: String,
    status: String,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Serialize)]
struct JobView {
    #[serde(flatten)]
    job: JobOut,
    /// For a finished export: a fresh download link (valid 1 hour).
    download_url: Option<String>,
}

fn storage(st: &AppState) -> Result<&domain::storage::Storage> {
    st.storage
        .as_deref()
        .ok_or(AppError::Unavailable("file storage isn't configured"))
}

async fn start_export(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<ExportIn>,
) -> Result<(StatusCode, Json<Queued>)> {
    storage(&st)?;
    guard(&st, uid, jobs::EXPORT, 5).await?;
    let job_id = jobs::enqueue(
        &st.db,
        jobs::EXPORT,
        ExportPayload {
            offset: input.offset,
        },
        Some(uid),
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(Queued { job_id })))
}

async fn start_upload(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
) -> Result<Json<UploadOut>> {
    let storage = storage(&st)?;
    st.limiter
        .check(format!("upload:{uid}"), 20, Duration::from_secs(86_400))?;
    let import_id = Uuid::new_v4();
    let key = jobs::import_key(uid, import_id);
    Ok(Json(UploadOut {
        import_id,
        upload_url: storage.put_url(&key, Duration::from_secs(900)),
    }))
}

/// Parses and checks the uploaded file; the result is a preview. Nothing is imported yet.
async fn validate(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(import_id): Path<Uuid>,
    Json(input): Json<ValidateIn>,
) -> Result<(StatusCode, Json<Queued>)> {
    storage(&st)?;
    guard(&st, uid, jobs::IMPORT_VALIDATE, 20).await?;
    let payload = ValidatePayload {
        key: jobs::import_key(uid, import_id),
        mapping: input.mapping,
    };
    let job_id = jobs::enqueue(&st.db, jobs::IMPORT_VALIDATE, payload, Some(uid)).await?;
    Ok((StatusCode::ACCEPTED, Json(Queued { job_id })))
}

/// Imports exactly the rows the preview (validate job `id`) showed.
async fn commit(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<Queued>)> {
    let preview = owned_job(&st, uid, id).await?;
    if preview.kind != jobs::IMPORT_VALIDATE || preview.status != "done" {
        return Err(AppError::BadRequest("that preview isn't ready"));
    }
    let already = st
        .db
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT 1 AS x FROM jobs WHERE kind = $1 AND user_id = $2 AND payload->>'import_id' = $3",
            [jobs::IMPORT_COMMIT.into(), uid.into(), id.to_string().into()],
        ))
        .await?;
    if already.is_some() {
        return Err(AppError::Conflict("this import was already started"));
    }
    let job_id = jobs::enqueue(
        &st.db,
        jobs::IMPORT_COMMIT,
        CommitPayload { import_id: id },
        Some(uid),
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(Queued { job_id })))
}

async fn job(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<JobView>> {
    let job = owned_job(&st, uid, id).await?;
    let download_url = match (&job.result, job.kind.as_str(), &st.storage) {
        (Some(r), jobs::EXPORT, Some(storage)) if job.status == "done" => {
            let filename = r["filename"].as_str().unwrap_or("cash-memo.csv");
            Some(storage.get_url(
                &jobs::export_key(uid, job.id),
                filename,
                Duration::from_secs(3600),
            ))
        }
        _ => None,
    };
    Ok(Json(JobView { job, download_url }))
}

async fn owned_job(st: &AppState, uid: Uuid, id: Uuid) -> Result<JobOut> {
    JobOut::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT id, kind, status, result, error FROM jobs WHERE id = $1 AND user_id = $2",
        [id.into(), uid.into()],
    ))
    .one(&st.db)
    .await?
    .ok_or(AppError::NotFound)
}

/// One job of a kind at a time per user, and at most `per_day` per day.
async fn guard(st: &AppState, uid: Uuid, kind: &str, per_day: i64) -> Result<()> {
    #[derive(FromQueryResult)]
    struct Counts {
        active: i64,
        today: i64,
    }
    let c = Counts::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT count(*) FILTER (WHERE status IN ('queued', 'running'))::bigint AS active,
                count(*) FILTER (WHERE created_at > now() - interval '1 day')::bigint AS today
         FROM jobs WHERE user_id = $1 AND kind = $2",
        [uid.into(), kind.into()],
    ))
    .one(&st.db)
    .await?
    .ok_or(AppError::Internal("count jobs".into()))?;
    if c.active > 0 {
        return Err(AppError::Conflict("one is already running"));
    }
    if c.today >= per_day {
        return Err(AppError::TooManyRequests);
    }
    Ok(())
}
