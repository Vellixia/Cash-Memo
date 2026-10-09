//! Analytics for the Reports page: income/expense per currency and spending by category, either
//! bucketed by local month (trend) or compared across two like-for-like periods (compare). A
//! small fixed number of grouped queries, never one per month.
use std::collections::HashSet;

use axum::{Router, extract::State, routing::get};
use chrono::{DateTime, Datelike, FixedOffset, Months, NaiveDate, Utc};
use sea_orm::{DatabaseConnection, DbBackend, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    error::{AppError, Json, Query, Result},
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/reports/trend", get(trend))
        .route("/reports/compare", get(compare))
}

#[derive(Deserialize)]
struct TrendQuery {
    months: u32,
    /// Client's UTC offset in minutes east, so months follow local time (same convention as
    /// /memos and /summary).
    #[serde(default)]
    offset: i32,
    /// Optional IANA timezone; adjusts historical month boundaries for DST.
    #[serde(default)]
    time_zone: Option<String>,
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
    total_minor: i64,
}

#[derive(FromQueryResult)]
struct ZoneName {
    name: String,
}

#[derive(Serialize)]
struct Trend {
    /// Every month in range, oldest first, even ones with no memos at all.
    months: Vec<String>,
    totals: Vec<MonthTotal>,
    /// Expense only (spending), grouped by category — mirrors Home's SpendingCard.
    by_category: Vec<MonthCategoryTotal>,
    /// Dated after today but still this month, so not in `totals` (Home counts them).
    scheduled: Vec<Total>,
}

async fn trend(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<TrendQuery>,
) -> Result<Json<Trend>> {
    if q.months != 3 && q.months != 6 && q.months != 12 {
        return Err(AppError::BadRequest("months must be 3, 6 or 12"));
    }
    let tz = fixed_offset(q.offset)?;
    let today = Utc::now().with_timezone(&tz).date_naive();
    let this_month = today.with_day(1).unwrap();
    let start_month = this_month
        .checked_sub_months(Months::new(q.months - 1))
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    // The range ends with today, not `now()`: installments and recurring memos are stamped at
    // local noon, so a `now()` cut-off would hide today's memos all morning. Memos dated after
    // today (future installments, scheduled entries) stay out, so the current month is to date.
    let end_day = today
        .succ_opt()
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    let months = (0..q.months)
        .map(|i| {
            start_month
                .checked_add_months(Months::new(i))
                .unwrap()
                .format("%Y-%m")
                .to_string()
        })
        .collect();

    let scope = Scope::new(&st.db, uid, &q.zone_query(), tz, start_month, end_day).await?;
    let month_expr = &scope.month_expr;
    let from = &scope.from;

    let totals = MonthTotal::find_by_statement(scope.stmt(format!(
        "SELECT {month_expr} AS month, currency::text AS currency, direction,
                SUM(amount_minor)::bigint AS total_minor
         {from} AND direction <> 'transfer'
         GROUP BY month, currency, direction ORDER BY month, currency, direction"
    )))
    .all(&st.db)
    .await?;
    let by_category = MonthCategoryTotal::find_by_statement(scope.stmt(format!(
        "SELECT {month_expr} AS month, category_id, currency::text AS currency,
                SUM(amount_minor)::bigint AS total_minor
         {from} AND direction = 'expense'
         GROUP BY month, category_id, currency ORDER BY month, total_minor DESC"
    )))
    .all(&st.db)
    .await?;

    // Rest of this month: [tomorrow, first of next month).
    let next_month = this_month
        .checked_add_months(Months::new(1))
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    let rest = Scope::new(&st.db, uid, &q.zone_query(), tz, end_day, next_month).await?;
    let scheduled = Total::find_by_statement(rest.stmt(format!(
        "SELECT currency::text AS currency, direction, SUM(amount_minor)::bigint AS total_minor
         {} AND direction <> 'transfer'
         GROUP BY currency, direction ORDER BY currency, direction",
        rest.from
    )))
    .all(&st.db)
    .await?;
    Ok(Json(Trend {
        months,
        totals,
        by_category,
        scheduled,
    }))
}

#[derive(Deserialize)]
struct CompareQuery {
    months: u32,
    /// Same offset / time_zone convention as the trend endpoint.
    #[serde(default)]
    offset: i32,
    #[serde(default)]
    time_zone: Option<String>,
}

#[derive(Serialize)]
struct Period {
    /// Inclusive local dates, "YYYY-MM-DD".
    start: String,
    end: String,
    totals: Vec<Total>,
    /// Expense only, like the trend.
    by_category: Vec<CategoryTotal>,
}

#[derive(Serialize)]
struct Compare {
    current: Period,
    previous: Period,
}

/// Like-for-like comparison: the last `months` calendar months to date against the `months`
/// before them, cut at the same day of the month so a partial month isn't judged against a full one.
async fn compare(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<CompareQuery>,
) -> Result<Json<Compare>> {
    if !matches!(q.months, 1 | 3 | 6 | 12) {
        return Err(AppError::BadRequest("months must be 1, 3, 6 or 12"));
    }
    let tz = fixed_offset(q.offset)?;
    let today = Utc::now().with_timezone(&tz).date_naive();
    let this_month = today.with_day(1).unwrap();
    let current_start = this_month
        .checked_sub_months(Months::new(q.months - 1))
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    let previous_start = this_month
        .checked_sub_months(Months::new(2 * q.months - 1))
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    // Same day in the month `months` back, clamped (e.g. Mar 31 -> Feb 28).
    let cut_month = this_month
        .checked_sub_months(Months::new(q.months))
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    let days_in_cut_month = cut_month
        .checked_add_months(Months::new(1))
        .and_then(|d| d.pred_opt())
        .ok_or(AppError::BadRequest("range out of bounds"))?
        .day();
    let previous_end = cut_month
        .with_day(today.day().min(days_in_cut_month))
        .unwrap();

    let zone = q.time_zone.as_deref();
    let current = period(&st.db, uid, zone, q.offset, tz, current_start, today).await?;
    let previous = period(
        &st.db,
        uid,
        zone,
        q.offset,
        tz,
        previous_start,
        previous_end,
    )
    .await?;
    Ok(Json(Compare { current, previous }))
}

/// Totals and expense-by-category over local dates `start..=end`.
async fn period(
    db: &DatabaseConnection,
    uid: Uuid,
    zone: Option<&str>,
    offset: i32,
    tz: FixedOffset,
    start: NaiveDate,
    end: NaiveDate,
) -> Result<Period> {
    let end_exclusive = end
        .succ_opt()
        .ok_or(AppError::BadRequest("range out of bounds"))?;
    let scope = Scope::new(
        db,
        uid,
        &ZoneQuery { zone, offset },
        tz,
        start,
        end_exclusive,
    )
    .await?;
    let from = &scope.from;
    let totals = Total::find_by_statement(scope.stmt(format!(
        "SELECT currency::text AS currency, direction, SUM(amount_minor)::bigint AS total_minor
         {from} AND direction <> 'transfer'
         GROUP BY currency, direction ORDER BY currency, direction"
    )))
    .all(db)
    .await?;
    let by_category = CategoryTotal::find_by_statement(scope.stmt(format!(
        "SELECT category_id, currency::text AS currency, SUM(amount_minor)::bigint AS total_minor
         {from} AND direction = 'expense'
         GROUP BY category_id, currency ORDER BY total_minor DESC"
    )))
    .all(db)
    .await?;
    Ok(Period {
        start: start.to_string(),
        end: end.to_string(),
        totals,
        by_category,
    })
}

struct ZoneQuery<'a> {
    zone: Option<&'a str>,
    offset: i32,
}

impl TrendQuery {
    fn zone_query(&self) -> ZoneQuery<'_> {
        ZoneQuery {
            zone: self.time_zone.as_deref(),
            offset: self.offset,
        }
    }
}

/// Memo filter for one local date range, shared by every report query: `$1` is the user, and
/// `from` is a `FROM memos WHERE ...` fragment bounded by `[start, end_exclusive)` in local time.
struct Scope {
    from: String,
    /// Local "YYYY-MM" of `occurred_at`; only valid in queries built on `from`.
    month_expr: String,
    params: Vec<sea_orm::Value>,
}

impl Scope {
    async fn new(
        db: &DatabaseConnection,
        uid: Uuid,
        q: &ZoneQuery<'_>,
        tz: FixedOffset,
        start: NaiveDate,
        end_exclusive: NaiveDate,
    ) -> Result<Scope> {
        // IANA zone accounts for DST at *each historical transaction* and at range boundaries.
        // Keep fixed-offset fallback for old API clients.
        Ok(if let Some(zone) = q.zone {
            check_time_zone(db, zone).await?;
            Scope {
                month_expr: "to_char(occurred_at AT TIME ZONE $4, 'YYYY-MM')".into(),
                from: "FROM memos
                 WHERE user_id = $1 AND deleted_at IS NULL
                   AND occurred_at >= ($2::date::timestamp AT TIME ZONE $4)
                   AND occurred_at < ($3::date::timestamp AT TIME ZONE $4)"
                    .into(),
                params: vec![uid.into(), start.into(), end_exclusive.into(), zone.into()],
            }
        } else {
            Scope {
                month_expr:
                    "to_char((occurred_at AT TIME ZONE 'UTC') + make_interval(mins => $4), 'YYYY-MM')"
                        .into(),
                from: "FROM memos
                 WHERE user_id = $1 AND deleted_at IS NULL
                   AND occurred_at >= $2 AND occurred_at < $3"
                    .into(),
                params: vec![
                    uid.into(),
                    local_midnight(start, tz)?.into(),
                    local_midnight(end_exclusive, tz)?.into(),
                    q.offset.into(),
                ],
            }
        })
    }

    fn stmt(&self, sql: String) -> Statement {
        Statement::from_sql_and_values(DbBackend::Postgres, sql, self.params.clone())
    }
}

/// Valid zone names, loaded once: `pg_timezone_names` is a slow view, too slow to hit per request.
static ZONES: tokio::sync::OnceCell<HashSet<String>> = tokio::sync::OnceCell::const_new();

async fn check_time_zone(db: &DatabaseConnection, zone: &str) -> Result<()> {
    if zone.is_empty() || zone.len() > 100 {
        return Err(AppError::BadRequest("invalid time_zone"));
    }
    let zones = ZONES
        .get_or_try_init(|| async {
            let rows = ZoneName::find_by_statement(Statement::from_string(
                DbBackend::Postgres,
                "SELECT name FROM pg_timezone_names",
            ))
            .all(db)
            .await?;
            Ok::<_, AppError>(rows.into_iter().map(|r| r.name).collect())
        })
        .await?;
    if zones.contains(zone) {
        Ok(())
    } else {
        Err(AppError::BadRequest("invalid time_zone"))
    }
}

fn fixed_offset(offset: i32) -> Result<FixedOffset> {
    offset
        .checked_mul(60)
        .and_then(FixedOffset::east_opt)
        .ok_or(AppError::BadRequest("invalid offset"))
}

fn local_midnight(d: NaiveDate, tz: FixedOffset) -> Result<DateTime<Utc>> {
    d.and_hms_opt(0, 0, 0)
        .and_then(|t| t.and_local_timezone(tz).single())
        .map(|t| t.with_timezone(&Utc))
        .ok_or(AppError::BadRequest("date out of range"))
}
