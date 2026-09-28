//! Multi-month analytics for the Reports page: income/expense per currency and spending by
//! category, bucketed by local month. Two grouped queries, never one per month.
use axum::{Router, extract::State, routing::get};
use chrono::{DateTime, Datelike, FixedOffset, Months, NaiveDate, Utc};
use sea_orm::{DbBackend, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    error::{AppError, Json, Query, Result},
};

pub fn routes() -> Router<AppState> {
    Router::new().route("/reports/trend", get(trend))
}

#[derive(Deserialize)]
struct TrendQuery {
    months: u32,
    /// Client's UTC offset in minutes east, so months follow local time (same convention as
    /// /memos and /summary).
    #[serde(default)]
    offset: i32,
}

#[derive(Serialize, FromQueryResult)]
struct MonthTotal {
    month: String,
    currency: String,
    direction: String,
    total_minor: i64,
}

#[derive(Serialize, FromQueryResult)]
struct MonthCategoryTotal {
    month: String,
    category_id: Option<Uuid>,
    currency: String,
    total_minor: i64,
}

#[derive(Serialize)]
struct Trend {
    /// Every month in range, oldest first, even ones with no memos at all.
    months: Vec<String>,
    totals: Vec<MonthTotal>,
    /// Expense only (spending), grouped by category — mirrors Home's SpendingCard.
    by_category: Vec<MonthCategoryTotal>,
}

async fn trend(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<TrendQuery>,
) -> Result<Json<Trend>> {
    if q.months != 6 && q.months != 12 {
        return Err(AppError::BadRequest("months must be 6 or 12"));
    }
    let tz = q
        .offset
        .checked_mul(60)
        .and_then(FixedOffset::east_opt)
        .ok_or(AppError::BadRequest("invalid offset"))?;
    let this_month = Utc::now()
        .with_timezone(&tz)
        .date_naive()
        .with_day(1)
        .unwrap();
    let start_month = this_month
        .checked_sub_months(Months::new(q.months - 1))
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    let start = local_midnight(start_month, tz)?;
    let end = local_midnight(
        this_month
            .checked_add_months(Months::new(1))
            .ok_or(AppError::BadRequest("range out of bounds"))?,
        tz,
    )?;
    let months = (0..q.months)
        .map(|i| {
            start_month
                .checked_add_months(Months::new(i))
                .unwrap()
                .format("%Y-%m")
                .to_string()
        })
        .collect();

    // `occurred_at AT TIME ZONE 'UTC'` turns the timestamptz into a plain timestamp holding the
    // same instant's UTC clock fields; adding the client's offset then shifts it to local wall
    // time, so `to_char` reads the month the user actually saw (not the server's/session's zone).
    let month_expr =
        "to_char((occurred_at AT TIME ZONE 'UTC') + make_interval(mins => $4), 'YYYY-MM')";
    let stmt = |sql: String| {
        Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            [uid.into(), start.into(), end.into(), q.offset.into()],
        )
    };
    let scope = "FROM memos
         WHERE user_id = $1 AND deleted_at IS NULL AND occurred_at >= $2 AND occurred_at < $3";
    let totals = MonthTotal::find_by_statement(stmt(format!(
        "SELECT {month_expr} AS month, currency::text AS currency, direction,
                SUM(amount_minor)::bigint AS total_minor
         {scope} AND direction <> 'transfer'
         GROUP BY month, currency, direction ORDER BY month, currency, direction"
    )))
    .all(&st.db)
    .await?;
    let by_category = MonthCategoryTotal::find_by_statement(stmt(format!(
        "SELECT {month_expr} AS month, category_id, currency::text AS currency,
                SUM(amount_minor)::bigint AS total_minor
         {scope} AND direction = 'expense'
         GROUP BY month, category_id, currency ORDER BY month, total_minor DESC"
    )))
    .all(&st.db)
    .await?;
    Ok(Json(Trend {
        months,
        totals,
        by_category,
    }))
}

fn local_midnight(d: NaiveDate, tz: FixedOffset) -> Result<DateTime<Utc>> {
    d.and_hms_opt(0, 0, 0)
        .and_then(|t| t.and_local_timezone(tz).single())
        .map(|t| t.with_timezone(&Utc))
        .ok_or(AppError::BadRequest("date out of range"))
}
