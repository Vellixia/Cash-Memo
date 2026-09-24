use axum::{Router, extract::State, http::StatusCode, routing::get};
use chrono::{DateTime, FixedOffset, Months, NaiveDate, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbBackend, EntityTrait, FromQueryResult, IntoActiveModel,
    QueryFilter, QueryOrder, Set, Statement,
};
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::{category, memo},
    error::{AppError, Json, Path, Query, Result},
    parse_direction,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/memos", get(list).post(create))
        .route("/memos/{id}", get(read).patch(update).delete(remove))
        .route("/summary", get(summary))
}

#[derive(Deserialize)]
struct MonthQuery {
    month: String,
    /// Client's UTC offset in minutes east, so month boundaries follow local time.
    #[serde(default)]
    offset: i32,
    category_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct MemoIn {
    direction: Option<String>,
    amount_minor: Option<i64>,
    currency: Option<String>,
    occurred_at: Option<DateTime<Utc>>,
    #[serde(default, deserialize_with = "present")]
    category_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "present")]
    note: Option<Option<String>>,
}

/// Distinguishes `"field": null` (Some(None)) from a missing field (None) in PATCH bodies.
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<Option<T>>, D::Error> {
    Option::deserialize(d).map(Some)
}

async fn list(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<MonthQuery>,
) -> Result<Json<Vec<memo::Model>>> {
    let (start, end) = month_range(&q.month, q.offset)?;
    let mut find = memo::Entity::find()
        .filter(memo::Column::UserId.eq(uid))
        .filter(memo::Column::DeletedAt.is_null())
        .filter(memo::Column::OccurredAt.gte(start))
        .filter(memo::Column::OccurredAt.lt(end));
    if let Some(c) = q.category_id {
        find = find.filter(memo::Column::CategoryId.eq(c));
    }
    Ok(Json(
        find.order_by_desc(memo::Column::OccurredAt)
            .all(&st.db)
            .await?,
    ))
}

async fn create(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<MemoIn>,
) -> Result<(StatusCode, Json<memo::Model>)> {
    let now = Utc::now();
    let mut m = memo::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(uid),
        deleted_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        category_id: Set(None),
        note: Set(None),
        ..Default::default()
    };
    let (Some(_), Some(_), Some(_), Some(_)) = (
        &input.direction,
        input.amount_minor,
        &input.currency,
        input.occurred_at,
    ) else {
        return Err(AppError::BadRequest(
            "direction, amount_minor, currency and occurred_at are required",
        ));
    };
    apply(&st, uid, &mut m, input).await?;
    Ok((StatusCode::CREATED, Json(m.insert(&st.db).await?)))
}

async fn read(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<Json<memo::Model>> {
    Ok(Json(owned(&st, uid, id).await?))
}

async fn update(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<MemoIn>,
) -> Result<Json<memo::Model>> {
    let mut m = owned(&st, uid, id).await?.into_active_model();
    apply(&st, uid, &mut m, input).await?;
    m.updated_at = Set(Utc::now());
    Ok(Json(m.update(&st.db).await?))
}

async fn remove(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    let mut m = owned(&st, uid, id).await?.into_active_model();
    m.deleted_at = Set(Some(Utc::now()));
    m.update(&st.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize, FromQueryResult)]
struct Total {
    currency: String,
    direction: String,
    total_minor: i64,
}

#[derive(Serialize, FromQueryResult)]
struct CategoryTotal {
    category_id: Option<Uuid>,
    currency: String,
    direction: String,
    total_minor: i64,
}

#[derive(Serialize)]
struct Summary {
    month: String,
    totals: Vec<Total>,
    by_category: Vec<CategoryTotal>,
}

async fn summary(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<MonthQuery>,
) -> Result<Json<Summary>> {
    let (start, end) = month_range(&q.month, q.offset)?;
    let scope = "FROM memos
         WHERE user_id = $1 AND deleted_at IS NULL AND occurred_at >= $2 AND occurred_at < $3";
    let stmt = |sql: String| {
        Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            [uid.into(), start.into(), end.into()],
        )
    };
    let totals = Total::find_by_statement(stmt(format!(
        "SELECT currency::text AS currency, direction, SUM(amount_minor)::bigint AS total_minor {scope}
         GROUP BY currency, direction ORDER BY currency, direction"
    )))
    .all(&st.db)
    .await?;
    let by_category = CategoryTotal::find_by_statement(stmt(format!(
        "SELECT category_id, currency::text AS currency, direction, SUM(amount_minor)::bigint AS total_minor {scope}
         GROUP BY category_id, currency, direction ORDER BY total_minor DESC, currency"
    )))
    .all(&st.db)
    .await?;
    Ok(Json(Summary {
        month: q.month,
        totals,
        by_category,
    }))
}

async fn owned(st: &AppState, uid: Uuid, id: Uuid) -> Result<memo::Model> {
    memo::Entity::find_by_id(id)
        .filter(memo::Column::UserId.eq(uid))
        .filter(memo::Column::DeletedAt.is_null())
        .one(&st.db)
        .await?
        .ok_or(AppError::NotFound)
}

/// Validates the provided fields and copies them onto the active model.
async fn apply(st: &AppState, uid: Uuid, m: &mut memo::ActiveModel, input: MemoIn) -> Result<()> {
    if let Some(d) = input.direction {
        m.direction = Set(parse_direction(&d)?);
    }
    if let Some(a) = input.amount_minor {
        if a <= 0 {
            return Err(AppError::BadRequest("amount_minor must be positive"));
        }
        m.amount_minor = Set(a);
    }
    if let Some(c) = input.currency {
        let c = c.trim().to_uppercase();
        if c.len() != 3 || !c.chars().all(|ch| ch.is_ascii_uppercase()) {
            return Err(AppError::BadRequest("currency must be a 3-letter ISO code"));
        }
        m.currency = Set(c);
    }
    if let Some(t) = input.occurred_at {
        m.occurred_at = Set(t);
    }
    if let Some(cat) = input.category_id {
        m.category_id = Set(cat);
    }
    if let Some(note) = input.note {
        m.note = Set(note.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty()));
    }
    // Checked on the final state, so changing only the direction can't orphan the category.
    if let Some(cid) = *m.category_id.as_ref() {
        let c = category::Entity::find_by_id(cid)
            .filter(category::Column::UserId.eq(uid))
            .one(&st.db)
            .await?
            .ok_or(AppError::BadRequest("unknown category"))?;
        if &c.direction != m.direction.as_ref() {
            return Err(AppError::BadRequest(
                "category direction does not match memo direction",
            ));
        }
    }
    Ok(())
}

fn month_range(month: &str, offset_minutes: i32) -> Result<(DateTime<Utc>, DateTime<Utc>)> {
    let start = NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("month must be YYYY-MM"))?;
    let end = start
        .checked_add_months(Months::new(1))
        .ok_or(AppError::BadRequest("month out of range"))?;
    let tz = offset_minutes
        .checked_mul(60)
        .and_then(FixedOffset::east_opt)
        .ok_or(AppError::BadRequest("invalid offset"))?;
    let utc = |d: NaiveDate| {
        d.and_hms_opt(0, 0, 0)
            .and_then(|t| t.and_local_timezone(tz).single())
            .map(|t| t.with_timezone(&Utc))
            .ok_or(AppError::BadRequest("month out of range"))
    };
    Ok((utc(start)?, utc(end)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn month_range_follows_offset() {
        let (s, e) = month_range("2026-12", 420).unwrap();
        assert_eq!(s.to_rfc3339(), "2026-11-30T17:00:00+00:00");
        assert_eq!(e.to_rfc3339(), "2026-12-31T17:00:00+00:00");
        assert!(month_range("2026-13", 0).is_err());
        assert!(month_range("nope", 0).is_err());
    }
}
