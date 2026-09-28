//! Credit/paylater installment plans: creating one writes all N expense memos upfront.
use axum::{Router, extract::State, http::StatusCode, routing::get};
use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, NaiveTime, TimeZone, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, FromQueryResult,
    QueryFilter, Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::{category, installment_plan, memo, source},
    error::{AppError, Json, Path, Result},
    parse_currency,
    sources::is_debt_kind,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/installments", get(list).post(create))
        .route("/installments/{id}", axum::routing::delete(remove))
}

#[derive(Deserialize)]
struct PlanIn {
    source_id: Uuid,
    #[serde(default)]
    category_id: Option<Uuid>,
    #[serde(default)]
    note: Option<String>,
    currency: String,
    principal_minor: i64,
    #[serde(default)]
    fee_minor: i64,
    months: i16,
    first_date: NaiveDate,
    /// Client's UTC offset in minutes east, so each installment lands at local noon.
    #[serde(default)]
    offset: i32,
}

#[derive(Serialize, FromQueryResult)]
struct PlanOut {
    id: Uuid,
    source_id: Uuid,
    category_id: Option<Uuid>,
    note: Option<String>,
    currency: String,
    principal_minor: i64,
    fee_minor: i64,
    months: i16,
    first_date: NaiveDate,
    created_at: DateTime<Utc>,
    paid: i64,
    remaining: i64,
}

const SELECT_PLANS: &str = "SELECT p.id, p.source_id, p.category_id, p.note, p.currency::text AS currency,
         p.principal_minor, p.fee_minor, p.months, p.first_date, p.created_at,
         COUNT(m.id) FILTER (WHERE m.occurred_at <= now() AND m.deleted_at IS NULL)::bigint AS paid,
         COUNT(m.id) FILTER (WHERE m.occurred_at > now() AND m.deleted_at IS NULL)::bigint AS remaining
     FROM installment_plans p
     LEFT JOIN memos m ON m.installment_plan_id = p.id
     WHERE p.user_id = $1";

async fn list(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
) -> Result<Json<Vec<PlanOut>>> {
    let plans = PlanOut::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!("{SELECT_PLANS} GROUP BY p.id ORDER BY p.created_at"),
        [uid.into()],
    ))
    .all(&st.db)
    .await?;
    Ok(Json(plans))
}

async fn create(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<PlanIn>,
) -> Result<(StatusCode, Json<PlanOut>)> {
    if !(2..=36).contains(&input.months) {
        return Err(AppError::BadRequest("months must be between 2 and 36"));
    }
    if input.principal_minor <= 0 {
        return Err(AppError::BadRequest("principal_minor must be positive"));
    }
    if input.fee_minor < 0 {
        return Err(AppError::BadRequest("fee_minor can't be negative"));
    }
    let currency = parse_currency(&input.currency)?;
    let tz_minutes = input
        .offset
        .checked_mul(60)
        .ok_or(AppError::BadRequest("invalid offset"))?;
    let tz = FixedOffset::east_opt(tz_minutes).ok_or(AppError::BadRequest("invalid offset"))?;

    let txn = st.db.begin().await?;
    let src = source::Entity::find_by_id(input.source_id)
        .filter(source::Column::UserId.eq(uid))
        .one(&txn)
        .await?
        .ok_or(AppError::BadRequest("unknown source"))?;
    if !is_debt_kind(&src.kind) {
        return Err(AppError::BadRequest(
            "installments need a credit or pay-later source",
        ));
    }
    if src.archived_at.is_some() {
        return Err(AppError::BadRequest("that source is archived"));
    }
    if src.currency.as_ref().is_some_and(|c| *c != currency) {
        return Err(AppError::BadRequest(
            "memo currency does not match the source currency",
        ));
    }
    if let Some(cid) = input.category_id {
        let c = category::Entity::find_by_id(cid)
            .filter(category::Column::UserId.eq(uid))
            .one(&txn)
            .await?
            .ok_or(AppError::BadRequest("unknown category"))?;
        if c.direction != "expense" {
            return Err(AppError::BadRequest(
                "category direction does not match memo direction",
            ));
        }
    }

    let note = input
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_owned);
    let plan_id = Uuid::new_v4();
    let now = Utc::now();
    installment_plan::ActiveModel {
        id: Set(plan_id),
        user_id: Set(uid),
        source_id: Set(input.source_id),
        category_id: Set(input.category_id),
        note: Set(note.clone()),
        currency: Set(currency.clone()),
        principal_minor: Set(input.principal_minor),
        fee_minor: Set(input.fee_minor),
        months: Set(input.months),
        first_date: Set(input.first_date),
        created_at: Set(now),
    }
    .insert(&txn)
    .await?;

    // Whole-currency-minor-unit split: the remainder lands on the first installment.
    let total = input.principal_minor + input.fee_minor;
    let months = input.months as i64;
    let base = total / months;
    let remainder = total % months;
    for i in 0..input.months {
        let date = add_months_clamped(input.first_date, i as i32);
        let local = date.and_time(NaiveTime::from_hms_opt(12, 0, 0).unwrap());
        let occurred_at = tz
            .from_local_datetime(&local)
            .single()
            .ok_or(AppError::BadRequest("invalid date"))?
            .with_timezone(&Utc);
        let amount = if i == 0 { base + remainder } else { base };
        let label = format!("({}/{})", i + 1, input.months);
        let memo_note = Some(match &note {
            Some(n) => format!("{n} {label}"),
            None => label,
        });
        memo::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(uid),
            direction: Set("expense".into()),
            amount_minor: Set(amount),
            currency: Set(currency.clone()),
            occurred_at: Set(occurred_at),
            category_id: Set(input.category_id),
            source_id: Set(Some(input.source_id)),
            to_source_id: Set(None),
            note: Set(memo_note),
            installment_plan_id: Set(Some(plan_id)),
            deleted_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        }
        .insert(&txn)
        .await?;
    }

    let plan = find_plan(&txn, uid, plan_id).await?;
    txn.commit().await?;
    Ok((StatusCode::CREATED, Json(plan)))
}

/// Soft-deletes the plan's future memos (not yet due) and removes the plan; past memos stay
/// (their `installment_plan_id` is cleared by the FK's `ON DELETE SET NULL`).
async fn remove(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    let txn = st.db.begin().await?;
    installment_plan::Entity::find_by_id(id)
        .filter(installment_plan::Column::UserId.eq(uid))
        .one(&txn)
        .await?
        .ok_or(AppError::NotFound)?;
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "UPDATE memos SET deleted_at = now()
         WHERE installment_plan_id = $1 AND occurred_at > now() AND deleted_at IS NULL",
        [id.into()],
    ))
    .await?;
    installment_plan::Entity::delete_by_id(id)
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn find_plan(db: &impl ConnectionTrait, uid: Uuid, id: Uuid) -> Result<PlanOut> {
    PlanOut::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        format!("{SELECT_PLANS} AND p.id = $2 GROUP BY p.id"),
        [uid.into(), id.into()],
    ))
    .one(db)
    .await?
    .ok_or(AppError::NotFound)
}

/// Adds whole months to a date, clamping the day to the target month's last day
/// (e.g. Jan 31 + 1 month -> Feb 28/29).
fn add_months_clamped(d: NaiveDate, months: i32) -> NaiveDate {
    let total = d.month0() as i32 + months;
    let year = d.year() + total.div_euclid(12);
    let month = total.rem_euclid(12) as u32 + 1;
    let next_month_first = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("valid date");
    let last_day = next_month_first.pred_opt().expect("valid date").day();
    NaiveDate::from_ymd_opt(year, month, d.day().min(last_day)).expect("valid date")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_to_month_end() {
        let jan31 = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        assert_eq!(
            add_months_clamped(jan31, 1),
            NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
        );
        assert_eq!(
            add_months_clamped(jan31, 2),
            NaiveDate::from_ymd_opt(2026, 3, 31).unwrap()
        );
        // Crosses a year boundary.
        assert_eq!(
            add_months_clamped(jan31, 12),
            NaiveDate::from_ymd_opt(2027, 1, 31).unwrap()
        );
    }
}
