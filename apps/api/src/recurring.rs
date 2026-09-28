//! Recurring rules: memo templates that repeat. `domain::recurring` turns due ones into memos,
//! here right after a write and in apps/worker on a loop.
use axum::{Router, extract::State, http::StatusCode, routing::get};
use chrono::{DateTime, Datelike, Days, NaiveDate, Utc};
use domain::recurring as rec;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder, Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::{memo, recurring_rule as rule},
    error::{AppError, Json, Path, Query, Result},
    memos::{self, MemoIn},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/recurring", get(list).post(create))
        .route("/recurring/upcoming", get(upcoming))
        .route(
            "/recurring/{id}",
            axum::routing::patch(update).delete(remove),
        )
}

#[derive(Deserialize)]
struct RuleIn {
    /// Create only: the memo to repeat. It counts as the first occurrence and links to the rule.
    memo_id: Option<Uuid>,
    cadence: Option<String>,
    /// Local date of the next occurrence; monthly/yearly rules keep aiming for its day.
    next_date: Option<NaiveDate>,
    /// Client's UTC offset in minutes east: decides "today" and the memos' local noon.
    offset_minutes: Option<i32>,
    paused: Option<bool>,
    #[serde(flatten)]
    memo: MemoIn,
}

async fn list(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
) -> Result<Json<Vec<rule::Model>>> {
    Ok(Json(
        rule::Entity::find()
            .filter(rule::Column::UserId.eq(uid))
            .order_by_asc(rule::Column::NextDate)
            .all(&st.db)
            .await?,
    ))
}

async fn create(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<RuleIn>,
) -> Result<(StatusCode, Json<rule::Model>)> {
    let cadence = parse_cadence(input.cadence.as_deref().unwrap_or_default())?;
    let offset = parse_offset(input.offset_minutes.unwrap_or(0))?;
    let today = rec::local_date(Utc::now(), offset);
    let (mut m, next, anchor) = match input.memo_id {
        Some(id) => {
            let src = memos::owned(&st, uid, id).await?;
            let day = rec::local_date(src.occurred_at, offset);
            let next = input.next_date.unwrap_or_else(|| {
                // Past occurrences are left alone: they may already be in the ledger by hand.
                let next = rec::advance(day, &cadence, day.day());
                rec::roll_forward(next, &cadence, day.day(), today)
            });
            (src.into_active_model(), next, day.day())
        }
        None => {
            let (Some(_), Some(_), Some(_), Some(next)) = (
                &input.memo.direction,
                input.memo.amount_minor,
                &input.memo.currency,
                input.next_date,
            ) else {
                return Err(AppError::BadRequest(
                    "direction, amount_minor, currency and next_date are required",
                ));
            };
            let m = memo::ActiveModel {
                category_id: Set(None),
                source_id: Set(None),
                to_source_id: Set(None),
                note: Set(None),
                ..Default::default()
            };
            (m, next, next.day())
        }
    };
    let next = valid_date(next)?;
    memos::apply(&st, uid, &mut m, input.memo, input.memo_id.is_none()).await?;
    let mut r = rule::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(uid),
        cadence: Set(cadence),
        anchor_day: Set(anchor as i16),
        next_date: Set(next),
        offset_minutes: Set(offset),
        paused_at: Set(None),
        created_at: Set(Utc::now()),
        ..Default::default()
    };
    copy_fields(&m, &mut r);
    let r = r.insert(&st.db).await?;
    if let Some(id) = input.memo_id {
        let mut m = memos::owned(&st, uid, id).await?.into_active_model();
        m.recurring_rule_id = Set(Some(r.id));
        m.update(&st.db).await?;
    }
    Ok((StatusCode::CREATED, Json(catch_up(&st, uid, r).await?)))
}

/// PATCH is partial. `paused: false` resumes from the next occurrence on or after today;
/// occurrences while paused are skipped. Memos already created are never touched.
async fn update(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<RuleIn>,
) -> Result<Json<rule::Model>> {
    let cur = owned(&st, uid, id).await?;
    let mut m = memo::ActiveModel {
        direction: Set(cur.direction.clone()),
        amount_minor: Set(cur.amount_minor),
        currency: Set(cur.currency.clone()),
        category_id: Set(cur.category_id),
        source_id: Set(cur.source_id),
        to_source_id: Set(cur.to_source_id),
        note: Set(cur.note.clone()),
        ..Default::default()
    };
    memos::apply(&st, uid, &mut m, input.memo, false).await?;
    let mut r = cur.clone().into_active_model();
    copy_fields(&m, &mut r);

    let offset = parse_offset(input.offset_minutes.unwrap_or(cur.offset_minutes))?;
    r.offset_minutes = Set(offset);
    let cadence = match input.cadence {
        Some(c) => parse_cadence(&c)?,
        None => cur.cadence.clone(),
    };
    let mut next = valid_date(input.next_date.unwrap_or(cur.next_date))?;
    // A new date or cadence re-aims monthly/yearly rules at that day.
    if next != cur.next_date || cadence != cur.cadence {
        r.anchor_day = Set(next.day() as i16);
    }
    match input.paused {
        Some(true) if cur.paused_at.is_none() => r.paused_at = Set(Some(Utc::now())),
        Some(false) if cur.paused_at.is_some() => {
            r.paused_at = Set(None);
            let today = rec::local_date(Utc::now(), offset);
            next = rec::roll_forward(next, &cadence, *r.anchor_day.as_ref() as u32, today);
        }
        _ => {}
    }
    r.cadence = Set(cadence);
    r.next_date = Set(next);
    let r = r.update(&st.db).await?;
    Ok(Json(catch_up(&st, uid, r).await?))
}

/// Stops the rule. Memos it created stay (their link is cleared).
async fn remove(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    let res = rule::Entity::delete_many()
        .filter(rule::Column::Id.eq(id))
        .filter(rule::Column::UserId.eq(uid))
        .exec(&st.db)
        .await?;
    if res.rows_affected == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MonthQuery {
    month: String,
    #[serde(default)]
    offset: i32,
}

#[derive(Serialize)]
struct Upcoming {
    date: NaiveDate,
    occurred_at: DateTime<Utc>,
    #[serde(flatten)]
    rule: rule::Model,
}

/// Occurrences still to come in `month` (after today), for "upcoming" rows in the ledger.
async fn upcoming(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<MonthQuery>,
) -> Result<Json<Vec<Upcoming>>> {
    let today = rec::local_date(Utc::now(), parse_offset(q.offset)?);
    let mut out = Vec::new();
    for (r, dates) in pending(&st, uid, &q.month).await? {
        for date in dates.into_iter().filter(|d| *d > today) {
            out.push(Upcoming {
                date,
                occurred_at: rec::occurred_at(date, r.offset_minutes),
                rule: r.clone(),
            });
        }
    }
    out.sort_by_key(|u| u.date);
    Ok(Json(out))
}

/// Active rules with their not-yet-created occurrences in `month` (local dates).
pub(crate) async fn pending(
    st: &AppState,
    uid: Uuid,
    month: &str,
) -> Result<Vec<(rule::Model, Vec<NaiveDate>)>> {
    let (first, next_month) = memos::month_days(month)?;
    let last = next_month - Days::new(1);
    let rules = rule::Entity::find()
        .filter(rule::Column::UserId.eq(uid))
        .filter(rule::Column::PausedAt.is_null())
        .filter(rule::Column::NextDate.lte(last))
        .all(&st.db)
        .await?;
    Ok(rules
        .into_iter()
        .map(|r| {
            let d = rec::pending(r.next_date, &r.cadence, r.anchor_day as u32, first, last);
            (r, d)
        })
        .collect())
}

/// Creates the rule's memos that are already due, then returns the rule as it now is.
async fn catch_up(st: &AppState, uid: Uuid, r: rule::Model) -> Result<rule::Model> {
    if r.paused_at.is_some() || r.next_date > rec::local_date(Utc::now(), r.offset_minutes) {
        return Ok(r);
    }
    rec::materialize(&st.db, Some(uid), Utc::now()).await?;
    owned(st, uid, r.id).await
}

fn copy_fields(m: &memo::ActiveModel, r: &mut rule::ActiveModel) {
    r.direction = Set(m.direction.as_ref().clone());
    r.amount_minor = Set(*m.amount_minor.as_ref());
    r.currency = Set(m.currency.as_ref().clone());
    r.category_id = Set(*m.category_id.as_ref());
    r.source_id = Set(*m.source_id.as_ref());
    r.to_source_id = Set(*m.to_source_id.as_ref());
    r.note = Set(m.note.as_ref().clone());
}

async fn owned(st: &AppState, uid: Uuid, id: Uuid) -> Result<rule::Model> {
    rule::Entity::find_by_id(id)
        .filter(rule::Column::UserId.eq(uid))
        .one(&st.db)
        .await?
        .ok_or(AppError::NotFound)
}

fn parse_cadence(c: &str) -> Result<String> {
    rec::CADENCES
        .contains(&c)
        .then(|| c.to_owned())
        .ok_or(AppError::BadRequest(
            "cadence must be weekly, monthly or yearly",
        ))
}

fn parse_offset(o: i32) -> Result<i32> {
    (-1080..=1080)
        .contains(&o)
        .then_some(o)
        .ok_or(AppError::BadRequest("invalid offset"))
}

/// Keeps the date math (and catch-up loops) in a sane range.
fn valid_date(d: NaiveDate) -> Result<NaiveDate> {
    (2000..=2100)
        .contains(&d.year())
        .then_some(d)
        .ok_or(AppError::BadRequest("next_date out of range"))
}
