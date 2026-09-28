use axum::{Router, extract::State, routing::get};
use chrono::{DateTime, Utc};
use sea_orm::{DbBackend, FromQueryResult, Statement, Value};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::memo,
    error::{AppError, Json, Query, Result},
    memos::MemoOut,
};

pub fn routes() -> Router<AppState> {
    Router::new().route("/search", get(search))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    /// Keyset cursor from the last row of the previous page: "<occurred_at>,<id>".
    before: Option<String>,
    limit: Option<i64>,
}

/// Full-text-ish search (ILIKE) over a memo's note, category name and source/to-source name,
/// across all months. Keyset paginated like the export, newest first.
async fn search(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<MemoOut>>> {
    let term = q.q.trim();
    if term.chars().count() < 2 {
        return Err(AppError::BadRequest("search needs at least 2 characters"));
    }
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let pattern = format!("%{}%", like_escape(term));

    let mut values: Vec<Value> = vec![uid.into(), pattern.into()];
    let mut sql = String::from(
        "SELECT m.* FROM memos m
         LEFT JOIN categories c ON c.id = m.category_id
         LEFT JOIN sources s ON s.id = m.source_id
         LEFT JOIN sources t ON t.id = m.to_source_id
         WHERE m.user_id = $1 AND m.deleted_at IS NULL
           AND (m.note ILIKE $2 OR c.name ILIKE $2 OR s.name ILIKE $2 OR t.name ILIKE $2)",
    );
    if let Some(before) = &q.before {
        let (ts, id) = parse_cursor(before)?;
        values.push(ts.into());
        values.push(id.into());
        sql.push_str(&format!(
            " AND (m.occurred_at, m.id) < (${}, ${})",
            values.len() - 1,
            values.len()
        ));
    }
    values.push(limit.into());
    sql.push_str(&format!(
        " ORDER BY m.occurred_at DESC, m.id DESC LIMIT ${}",
        values.len()
    ));

    let memos = memo::Model::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        sql,
        values,
    ))
    .all(&st.db)
    .await?;
    Ok(Json(memos.into_iter().map(MemoOut::from).collect()))
}

fn parse_cursor(s: &str) -> Result<(DateTime<Utc>, Uuid)> {
    let (ts, id) = s
        .split_once(',')
        .ok_or(AppError::BadRequest("invalid cursor"))?;
    let ts = DateTime::parse_from_rfc3339(ts)
        .map_err(|_| AppError::BadRequest("invalid cursor"))?
        .with_timezone(&Utc);
    let id = Uuid::parse_str(id).map_err(|_| AppError::BadRequest("invalid cursor"))?;
    Ok((ts, id))
}

/// Escapes ILIKE wildcards so the user's text is matched literally.
fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
