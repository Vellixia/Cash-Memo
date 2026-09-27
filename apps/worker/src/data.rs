//! CSV export and import, and file cleanup. Built so a huge account can't hurt the database:
//! one job at a time, short keyset-paged queries of BATCH rows, a statement timeout on each,
//! a pause between batches, and files streamed through temp files (never held in memory).
use std::{collections::HashMap, io::Write, path::PathBuf, time::Duration};

use chrono::{DateTime, FixedOffset, Utc};
use domain::{
    import::{self, Mapping, Row},
    jobs::{self, CommitPayload, ExportPayload, Job, PurgePayload, ValidatePayload},
    money,
    storage::Storage,
};
use futures_util::StreamExt;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, FromQueryResult, Statement, TransactionTrait,
    Value,
};
use serde_json::{Value as Json, json};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const BATCH: usize = 1000;
const PAUSE: Duration = Duration::from_millis(50);
const MAX_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;
const MAX_ROWS: usize = 200_000;
/// Row-level problems kept for the preview; the rest are only counted.
const MAX_REPORTED_ERRORS: usize = 100;
const MAX_ATTEMPTS: i32 = 3;

pub struct Ctx {
    pub db: DatabaseConnection,
    pub storage: Storage,
    pub http: reqwest::Client,
}

pub async fn run(ctx: Ctx) {
    let kinds = [
        jobs::EXPORT,
        jobs::IMPORT_VALIDATE,
        jobs::IMPORT_COMMIT,
        jobs::PURGE_FILES,
    ];
    loop {
        match jobs::claim(&ctx.db, &kinds).await {
            Ok(Some(job)) => handle(&ctx, job).await,
            Ok(None) => tokio::time::sleep(Duration::from_secs(2)).await,
            Err(e) => {
                tracing::error!("claim data job: {e}");
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        }
    }
}

/// Runs one claimed job and records its outcome.
pub async fn handle(ctx: &Ctx, job: Job) {
    let result = match job.kind.as_str() {
        jobs::EXPORT => export(ctx, &job).await,
        jobs::IMPORT_VALIDATE => validate(ctx, &job).await,
        jobs::IMPORT_COMMIT => commit(ctx, &job).await,
        jobs::PURGE_FILES => purge(ctx, &job).await,
        other => Err(format!("unknown job kind {other}")),
    };
    let outcome = match result {
        Ok(r) => jobs::finish(&ctx.db, job.id, Some(r), false).await,
        Err(e) => jobs::fail(&ctx.db, &job, &e, MAX_ATTEMPTS)
            .await
            .map(|gave_up| {
                if gave_up {
                    tracing::error!(job = %job.id, kind = %job.kind, "job failed for good: {e}");
                } else {
                    tracing::warn!(job = %job.id, kind = %job.kind, "job failed, will retry: {e}");
                }
            }),
    };
    if let Err(e) = outcome {
        tracing::error!(job = %job.id, "update job: {e}");
    }
}

fn payload<T: serde::de::DeserializeOwned>(job: &Job) -> Result<T, String> {
    serde_json::from_value(job.payload.clone()).map_err(|e| format!("bad payload: {e}"))
}

fn user(job: &Job) -> Result<Uuid, String> {
    job.user_id.ok_or_else(|| "job has no user".to_owned())
}

fn db_err(e: sea_orm::DbErr) -> String {
    e.to_string()
}

/// Runs `stmts` in one short transaction with a statement timeout.
async fn in_txn(
    db: &DatabaseConnection,
    timeout: &str,
    stmts: Vec<Statement>,
) -> Result<Vec<u64>, String> {
    let txn = db.begin().await.map_err(db_err)?;
    txn.execute_unprepared(&format!("SET LOCAL statement_timeout = '{timeout}'"))
        .await
        .map_err(db_err)?;
    let mut affected = vec![];
    for s in stmts {
        affected.push(txn.execute_raw(s).await.map_err(db_err)?.rows_affected());
    }
    txn.commit().await.map_err(db_err)?;
    Ok(affected)
}

struct TempFile(PathBuf);

impl TempFile {
    fn new(job: &Job, what: &str) -> Self {
        TempFile(std::env::temp_dir().join(format!("cashmemo-{what}-{}.csv", job.id)))
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

// --- export ----------------------------------------------------------------------------------

#[derive(FromQueryResult)]
struct ExportRow {
    id: Uuid,
    occurred_at: DateTime<Utc>,
    direction: String,
    amount_minor: i64,
    currency: String,
    category: Option<String>,
    source: Option<String>,
    to_source: Option<String>,
    note: Option<String>,
}

async fn export(ctx: &Ctx, job: &Job) -> Result<Json, String> {
    let p: ExportPayload = payload(job)?;
    let uid = user(job)?;
    let tz = FixedOffset::east_opt(p.offset.saturating_mul(60)).ok_or("invalid offset")?;
    let tmp = TempFile::new(job, "export");
    let file = std::fs::File::create(&tmp.0).map_err(|e| e.to_string())?;
    let mut out = std::io::BufWriter::new(file);
    // BOM so spreadsheet apps read UTF-8 (Rp, €, emoji) correctly; our importer skips it.
    out.write_all("\u{feff}".as_bytes())
        .map_err(|e| e.to_string())?;
    let mut csv = csv::Writer::from_writer(out);
    csv.write_record([
        "date",
        "direction",
        "amount",
        "currency",
        "category",
        "source",
        "to_source",
        "note",
    ])
    .map_err(|e| e.to_string())?;

    let mut cursor: Option<(DateTime<Utc>, Uuid)> = None;
    let mut rows = 0usize;
    loop {
        let (after, values): (&str, Vec<Value>) = match cursor {
            None => ("", vec![uid.into()]),
            Some((t, id)) => (
                "AND (m.occurred_at, m.id) < ($2, $3)",
                vec![uid.into(), t.into(), id.into()],
            ),
        };
        let sql = format!(
            "SELECT m.id, m.occurred_at, m.direction, m.amount_minor, m.currency::text AS currency,
                    c.name AS category, s.name AS source, t.name AS to_source, m.note
             FROM memos m
             LEFT JOIN categories c ON c.id = m.category_id
             LEFT JOIN sources s ON s.id = m.source_id
             LEFT JOIN sources t ON t.id = m.to_source_id
             WHERE m.user_id = $1 AND m.deleted_at IS NULL {after}
             ORDER BY m.occurred_at DESC, m.id DESC LIMIT {BATCH}"
        );
        let txn = ctx.db.begin().await.map_err(db_err)?;
        txn.execute_unprepared("SET LOCAL statement_timeout = '30s'")
            .await
            .map_err(db_err)?;
        let batch = ExportRow::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            values,
        ))
        .all(&txn)
        .await
        .map_err(db_err)?;
        txn.commit().await.map_err(db_err)?;
        let Some(last) = batch.last() else { break };
        cursor = Some((last.occurred_at, last.id));
        for r in &batch {
            let text = |v: &Option<String>| v.as_deref().map(import::csv_safe).unwrap_or_default();
            csv.write_record([
                r.occurred_at.with_timezone(&tz).to_rfc3339(),
                r.direction.clone(),
                money::to_decimal(r.amount_minor, &r.currency),
                r.currency.clone(),
                text(&r.category),
                text(&r.source),
                text(&r.to_source),
                text(&r.note),
            ])
            .map_err(|e| e.to_string())?;
        }
        rows += batch.len();
        tokio::time::sleep(PAUSE).await;
    }
    csv.flush().map_err(|e| e.to_string())?;
    drop(csv);

    let key = jobs::export_key(uid, job.id);
    let file = tokio::fs::File::open(&tmp.0)
        .await
        .map_err(|e| e.to_string())?;
    let len = file.metadata().await.map_err(|e| e.to_string())?.len();
    let res = ctx
        .http
        .put(ctx.storage.put_url(&key, Duration::from_secs(900)))
        .header(reqwest::header::CONTENT_LENGTH, len)
        .header(reqwest::header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .body(reqwest::Body::from(file))
        .send()
        .await
        .map_err(|e| format!("upload export: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("upload export: {}", res.status()));
    }
    let filename = format!(
        "cash-memo-{}.csv",
        Utc::now().with_timezone(&tz).format("%Y-%m-%d")
    );
    Ok(json!({ "rows": rows, "filename": filename }))
}

// --- import: validate -----------------------------------------------------------------------

#[derive(Default)]
struct Report {
    rows: usize,
    valid: usize,
    error_count: usize,
    errors: Vec<Json>,
    currencies: HashMap<String, usize>,
}

async fn validate(ctx: &Ctx, job: &Job) -> Result<Json, String> {
    let p: ValidatePayload = payload(job)?;
    let uid = user(job)?;
    // A retry starts clean; stale previews older than a day are swept too.
    in_txn(
        &ctx.db,
        "30s",
        vec![Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM import_rows WHERE import_id = $1 OR created_at < now() - interval '1 day'",
            [job.id.into()],
        )],
    )
    .await?;

    let tmp = TempFile::new(job, "import");
    download(ctx, &p.key, &tmp.0).await?;

    // Existing sources with a currency lock: rows must match it, like the API enforces.
    #[derive(FromQueryResult)]
    struct Lock {
        name: String,
        currency: String,
    }
    let locks: HashMap<String, String> = Lock::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT name, currency::text AS currency FROM sources WHERE user_id = $1 AND currency IS NOT NULL",
        [uid.into()],
    ))
    .all(&ctx.db)
    .await
    .map_err(db_err)?
    .into_iter()
    .map(|l| (l.name, l.currency))
    .collect();

    // Parse on a blocking thread and hand over batches; the channel bound keeps memory flat.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<(i32, Row)>>(2);
    let path = tmp.0.clone();
    let mapping = p.mapping.clone();
    let parser = tokio::task::spawn_blocking(move || parse_file(&path, &mapping, &locks, tx));
    while let Some(batch) = rx.recv().await {
        stage(&ctx.db, job.id, uid, batch).await?;
        tokio::time::sleep(PAUSE).await;
    }
    let report = parser.await.map_err(|e| e.to_string())??;

    #[derive(FromQueryResult)]
    struct Preview {
        duplicates: i64,
        new_categories: Json,
        new_sources: Json,
    }
    let preview = Preview::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT
           (SELECT count(*) FROM import_rows r WHERE r.import_id = $1 AND EXISTS (
              SELECT 1 FROM memos m WHERE m.user_id = $2 AND m.deleted_at IS NULL
                AND m.occurred_at = r.occurred_at AND m.direction = r.direction
                AND m.amount_minor = r.amount_minor AND m.currency = r.currency
                AND m.note IS NOT DISTINCT FROM r.note))::bigint AS duplicates,
           (SELECT coalesce(jsonb_agg(DISTINCT r.category), '[]') FROM import_rows r
              WHERE r.import_id = $1 AND r.category IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM categories c WHERE c.user_id = $2 AND c.name = r.category AND c.direction = r.direction)) AS new_categories,
           (SELECT coalesce(jsonb_agg(DISTINCT n), '[]') FROM (
              SELECT source AS n FROM import_rows WHERE import_id = $1 AND source IS NOT NULL
              UNION SELECT to_source FROM import_rows WHERE import_id = $1 AND to_source IS NOT NULL) x
              WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.user_id = $2 AND s.name = x.n)) AS new_sources",
        [job.id.into(), uid.into()],
    ))
    .one(&ctx.db)
    .await
    .map_err(db_err)?
    .ok_or("preview query returned nothing")?;

    Ok(json!({
        "rows": report.rows,
        "valid": report.valid,
        "error_count": report.error_count,
        "errors": report.errors,
        "duplicates": preview.duplicates,
        "new_categories": preview.new_categories,
        "new_sources": preview.new_sources,
        "currencies": report.currencies,
        "committed": false,
    }))
}

async fn download(ctx: &Ctx, key: &str, path: &PathBuf) -> Result<(), String> {
    let res = ctx
        .http
        .get(
            ctx.storage
                .get_url(key, "import.csv", Duration::from_secs(600)),
        )
        .send()
        .await
        .map_err(|e| format!("download upload: {e}"))?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("the uploaded file wasn't found; upload it again".into());
    }
    if !res.status().is_success() {
        return Err(format!("download upload: {}", res.status()));
    }
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| e.to_string())?;
    let mut size = 0u64;
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        size += chunk.len() as u64;
        // ponytail: presigned PUTs can't cap size, so it's enforced here; a POST policy could cap it at upload.
        if size > MAX_UPLOAD_BYTES {
            return Err("the file is larger than 50 MB".into());
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())
}

fn parse_file(
    path: &PathBuf,
    mapping: &Mapping,
    locks: &HashMap<String, String>,
    tx: tokio::sync::mpsc::Sender<Vec<(i32, Row)>>,
) -> Result<Report, String> {
    if ![',', ';', '\t'].contains(&mapping.delimiter) {
        return Err("the separator must be a comma, semicolon or tab".into());
    }
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(mapping.delimiter as u8)
        .has_headers(mapping.has_header)
        .flexible(true)
        .from_path(path)
        .map_err(|e| e.to_string())?;
    let mut report = Report::default();
    let mut batch = Vec::with_capacity(BATCH);
    for (i, record) in reader.records().enumerate() {
        let line = i as i32 + if mapping.has_header { 2 } else { 1 };
        report.rows += 1;
        if report.rows > MAX_ROWS {
            return Err(format!(
                "the file has more than {MAX_ROWS} rows; split it up"
            ));
        }
        let row = record
            .map_err(|e| e.to_string())
            .and_then(|r| {
                let mut fields: Vec<&str> = r.iter().collect();
                if let Some(first) = fields.first_mut() {
                    *first = first.trim_start_matches('\u{feff}');
                }
                import::parse_row(&fields, mapping)
            })
            .and_then(|row| {
                for name in [&row.source, &row.to_source].into_iter().flatten() {
                    if let Some(cur) = locks.get(name).filter(|c| **c != row.currency) {
                        return Err(format!("source \"{name}\" only takes {cur}"));
                    }
                }
                Ok(row)
            });
        match row {
            Ok(row) => {
                report.valid += 1;
                *report.currencies.entry(row.currency.clone()).or_default() += 1;
                batch.push((line, row));
                if batch.len() == BATCH {
                    tx.blocking_send(std::mem::take(&mut batch))
                        .map_err(|_| "import stopped")?;
                }
            }
            Err(message) => {
                report.error_count += 1;
                if report.errors.len() < MAX_REPORTED_ERRORS {
                    report
                        .errors
                        .push(json!({ "line": line, "message": message }));
                }
            }
        }
    }
    if !batch.is_empty() {
        tx.blocking_send(batch).map_err(|_| "import stopped")?;
    }
    Ok(report)
}

/// One multi-row insert per batch via unnest (11 array parameters, not 11 000 scalars).
async fn stage(
    db: &DatabaseConnection,
    import_id: Uuid,
    uid: Uuid,
    batch: Vec<(i32, Row)>,
) -> Result<(), String> {
    let opt = |v: &Option<String>| v.clone().unwrap_or_default();
    let lines: Vec<i32> = batch.iter().map(|(l, _)| *l).collect();
    let dirs: Vec<String> = batch.iter().map(|(_, r)| r.direction.clone()).collect();
    let amounts: Vec<i64> = batch.iter().map(|(_, r)| r.amount_minor).collect();
    let currencies: Vec<String> = batch.iter().map(|(_, r)| r.currency.clone()).collect();
    let times: Vec<DateTime<Utc>> = batch.iter().map(|(_, r)| r.occurred_at).collect();
    let cats: Vec<String> = batch.iter().map(|(_, r)| opt(&r.category)).collect();
    let srcs: Vec<String> = batch.iter().map(|(_, r)| opt(&r.source)).collect();
    let tos: Vec<String> = batch.iter().map(|(_, r)| opt(&r.to_source)).collect();
    let notes: Vec<String> = batch.iter().map(|(_, r)| opt(&r.note)).collect();
    // Empty strings stand for "none": parse_row never yields an empty name or note.
    let stmt = Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO import_rows (import_id, user_id, line, direction, amount_minor, currency,
                                  occurred_at, category, source, to_source, note)
         SELECT $1, $2, u.line, u.dir, u.amount, u.cur, u.at,
                NULLIF(u.cat, ''), NULLIF(u.src, ''), NULLIF(u.dst, ''), NULLIF(u.note, '')
         FROM unnest($3::int[], $4::text[], $5::bigint[], $6::text[], $7::timestamptz[],
                     $8::text[], $9::text[], $10::text[], $11::text[])
              AS u(line, dir, amount, cur, at, cat, src, dst, note)",
        [
            import_id.into(),
            uid.into(),
            lines.into(),
            dirs.into(),
            amounts.into(),
            currencies.into(),
            times.into(),
            cats.into(),
            srcs.into(),
            tos.into(),
            notes.into(),
        ],
    );
    in_txn(db, "30s", vec![stmt]).await.map(|_| ())
}

// --- import: commit --------------------------------------------------------------------------

async fn commit(ctx: &Ctx, job: &Job) -> Result<Json, String> {
    let p: CommitPayload = payload(job)?;
    let uid = user(job)?;
    let v = |sql: &str| {
        Statement::from_sql_and_values(DbBackend::Postgres, sql, [p.import_id.into(), uid.into()])
    };
    let affected = in_txn(
        &ctx.db,
        "120s",
        vec![
            // The preview must be this user's and not imported yet (locks it for the transaction).
            v("SELECT 1 FROM jobs WHERE id = $1 AND user_id = $2 AND kind = 'import_validate'
                 AND NOT coalesce((result->>'committed')::boolean, false) FOR UPDATE"),
            v("INSERT INTO categories (id, user_id, name, direction)
               SELECT gen_random_uuid(), $2, x.category, x.direction FROM (
                 SELECT DISTINCT category, direction FROM import_rows
                 WHERE import_id = $1 AND category IS NOT NULL) x
               ON CONFLICT (user_id, name, direction) DO NOTHING"),
            v("INSERT INTO sources (id, user_id, name, kind)
               SELECT gen_random_uuid(), $2, x.n, 'other' FROM (
                 SELECT source AS n FROM import_rows WHERE import_id = $1 AND source IS NOT NULL
                 UNION SELECT to_source FROM import_rows WHERE import_id = $1 AND to_source IS NOT NULL) x
               ON CONFLICT (user_id, name) DO NOTHING"),
            v("INSERT INTO memos (id, user_id, direction, amount_minor, currency, occurred_at,
                                  category_id, source_id, to_source_id, note)
               SELECT gen_random_uuid(), $2, r.direction, r.amount_minor, r.currency, r.occurred_at,
                      c.id, s.id, t.id, r.note
               FROM import_rows r
               LEFT JOIN categories c ON c.user_id = $2 AND c.name = r.category AND c.direction = r.direction
               LEFT JOIN sources s ON s.user_id = $2 AND s.name = r.source
               LEFT JOIN sources t ON t.user_id = $2 AND t.name = r.to_source
               WHERE r.import_id = $1 AND NOT EXISTS (
                 SELECT 1 FROM memos m WHERE m.user_id = $2 AND m.deleted_at IS NULL
                   AND m.occurred_at = r.occurred_at AND m.direction = r.direction
                   AND m.amount_minor = r.amount_minor AND m.currency = r.currency
                   AND m.note IS NOT DISTINCT FROM r.note)"),
            v("DELETE FROM import_rows WHERE import_id = $1 AND user_id = $2"),
            v("UPDATE jobs SET result = jsonb_set(result, '{committed}', 'true') WHERE id = $1 AND user_id = $2"),
        ],
    )
    .await?;
    if affected[0] == 0 {
        return Err("that preview doesn't exist or was already imported".into());
    }
    let (inserted, staged) = (affected[3], affected[4]);
    Ok(json!({ "inserted": inserted, "duplicates": staged - inserted }))
}

// --- purge -----------------------------------------------------------------------------------

async fn purge(ctx: &Ctx, job: &Job) -> Result<Json, String> {
    let p: PurgePayload = payload(job)?;
    if !p.prefix.starts_with("users/") || p.prefix.len() < "users/x/".len() {
        return Err("refusing to purge outside a user prefix".into());
    }
    let mut deleted = 0;
    for _ in 0..100 {
        let xml = ctx
            .http
            .get(ctx.storage.list_url(&p.prefix, Duration::from_secs(300)))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("list: {e}"))?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        let keys = Storage::parse_list(&xml);
        if keys.is_empty() {
            break;
        }
        for key in keys {
            ctx.http
                .delete(ctx.storage.delete_url(&key, Duration::from_secs(300)))
                .send()
                .await
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("delete: {e}"))?;
            deleted += 1;
        }
    }
    Ok(json!({ "deleted": deleted }))
}
