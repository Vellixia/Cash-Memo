//! Recurring memos: the date math, and turning due occurrences into memos. Run by the API right
//! after a rule is written and by apps/worker on a short loop, so a restart never skips a day.
use chrono::{DateTime, Datelike, Days, Months, NaiveDate, TimeDelta, Utc};
use sea_orm::{
    ConnectionTrait, DbBackend, DbErr, FromQueryResult, Statement, TransactionSession,
    TransactionTrait,
};
use uuid::Uuid;

pub const CADENCES: [&str; 3] = ["weekly", "monthly", "yearly"];
/// Most occurrences one run creates per rule (e.g. after long downtime); older ones are skipped.
pub const MAX_CATCH_UP: usize = 60;
const BATCH: usize = 100;

/// The occurrence after `date`. Monthly and yearly land on `anchor_day`, clamped to the month's
/// end, so a rule on the 31st goes Jan 31, Feb 28, Mar 31.
pub fn advance(date: NaiveDate, cadence: &str, anchor_day: u32) -> NaiveDate {
    let months = match cadence {
        "weekly" => return date + Days::new(7),
        "yearly" => 12,
        _ => 1,
    };
    let first = date.with_day(1).expect("day 1") + Months::new(months);
    let last = (first + Months::new(1) - Days::new(1)).day();
    first.with_day(anchor_day.min(last)).expect("valid day")
}

/// The first occurrence on or after `today`, starting from `date`.
pub fn roll_forward(
    mut date: NaiveDate,
    cadence: &str,
    anchor_day: u32,
    today: NaiveDate,
) -> NaiveDate {
    while date < today {
        date = advance(date, cadence, anchor_day);
    }
    date
}

/// Occurrences not materialized yet (`next_date` on) that fall within `from..=to`.
pub fn pending(
    next_date: NaiveDate,
    cadence: &str,
    anchor_day: u32,
    from: NaiveDate,
    to: NaiveDate,
) -> Vec<NaiveDate> {
    let mut out = Vec::new();
    let mut d = next_date;
    while d <= to {
        if d >= from {
            out.push(d);
        }
        d = advance(d, cadence, anchor_day);
    }
    out
}

/// The calendar day at `t` for a client `offset_minutes` east of UTC.
pub fn local_date(t: DateTime<Utc>, offset_minutes: i32) -> NaiveDate {
    (t + TimeDelta::minutes(offset_minutes.into())).date_naive()
}

/// A materialized memo's time: local noon, far from midnight so it stays on its day nearby.
pub fn occurred_at(date: NaiveDate, offset_minutes: i32) -> DateTime<Utc> {
    (date.and_hms_opt(12, 0, 0).expect("noon") - TimeDelta::minutes(offset_minutes.into()))
        .and_utc()
}

#[derive(FromQueryResult)]
struct Due {
    id: Uuid,
    cadence: String,
    anchor_day: i16,
    next_date: NaiveDate,
    offset_minutes: i32,
}

/// Creates the memos of every unpaused rule due by `now` (only `user_id`'s if given) and moves
/// each rule's `next_date` past today, in one transaction per batch. Idempotent: rules are locked
/// (SKIP LOCKED, so racing runs split the work) and the insert ignores occurrences that already
/// have a memo. Returns how many memos were created.
pub async fn materialize<C>(db: &C, user_id: Option<Uuid>, now: DateTime<Utc>) -> Result<u64, DbErr>
where
    C: ConnectionTrait + TransactionTrait,
{
    let mut created = 0;
    loop {
        let txn = db.begin().await?;
        txn.execute_unprepared("SET LOCAL statement_timeout = '30s'")
            .await?;
        // The first date bound is only there to use the partial index (offsets stay under a day).
        let due = Due::find_by_statement(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "SELECT id, cadence, anchor_day, next_date, offset_minutes FROM recurring_rules
             WHERE paused_at IS NULL AND ($2::uuid IS NULL OR user_id = $2)
               AND next_date <= ($1::timestamptz AT TIME ZONE 'UTC')::date + 1
               AND next_date <= ($1::timestamptz AT TIME ZONE 'UTC' + make_interval(mins => offset_minutes))::date
             ORDER BY next_date LIMIT $3 FOR UPDATE SKIP LOCKED",
            [now.into(), user_id.into(), (BATCH as i64).into()],
        ))
        .all(&txn)
        .await?;
        for r in &due {
            let today = local_date(now, r.offset_minutes);
            let anchor = r.anchor_day as u32;
            let mut dates = Vec::new();
            let mut d = r.next_date;
            while d <= today {
                dates.push(occurred_at(d, r.offset_minutes));
                d = advance(d, &r.cadence, anchor);
            }
            let keep = dates.split_off(dates.len().saturating_sub(MAX_CATCH_UP));
            created += txn
                .execute_raw(Statement::from_sql_and_values(
                    DbBackend::Postgres,
                    "INSERT INTO memos (id, user_id, direction, amount_minor, currency, occurred_at,
                         category_id, source_id, to_source_id, note, recurring_rule_id)
                     SELECT gen_random_uuid(), r.user_id, r.direction, r.amount_minor, r.currency, t,
                         r.category_id, r.source_id, r.to_source_id, r.note, r.id
                     FROM recurring_rules r, unnest($2::timestamptz[]) t
                     WHERE r.id = $1
                     ON CONFLICT DO NOTHING",
                    [r.id.into(), keep.into()],
                ))
                .await?
                .rows_affected();
            txn.execute_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "UPDATE recurring_rules SET next_date = $2 WHERE id = $1",
                [r.id.into(), d.into()],
            ))
            .await?;
        }
        txn.commit().await?;
        if due.len() < BATCH {
            return Ok(created);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    #[test]
    fn month_end_clamps_and_returns() {
        let mut d = day("2026-01-31");
        let mut seen = vec![];
        for _ in 0..4 {
            d = advance(d, "monthly", 31);
            seen.push(d.to_string());
        }
        assert_eq!(
            seen,
            ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]
        );
        assert_eq!(advance(day("2027-02-28"), "yearly", 29), day("2028-02-29"));
        assert_eq!(advance(day("2028-02-29"), "yearly", 29), day("2029-02-28"));
        assert_eq!(advance(day("2026-12-29"), "weekly", 29), day("2027-01-05"));
        assert_eq!(
            roll_forward(day("2026-01-15"), "monthly", 15, day("2026-03-16")),
            day("2026-04-15")
        );
        assert_eq!(
            roll_forward(day("2026-01-15"), "monthly", 15, day("2026-03-15")),
            day("2026-03-15")
        );
        let p = pending(
            day("2026-09-30"),
            "weekly",
            30,
            day("2026-10-01"),
            day("2026-10-31"),
        );
        assert_eq!(
            p,
            [
                day("2026-10-07"),
                day("2026-10-14"),
                day("2026-10-21"),
                day("2026-10-28")
            ]
        );
    }

    #[test]
    fn local_noon() {
        let t = occurred_at(day("2026-10-01"), 420);
        assert_eq!(t.to_rfc3339(), "2026-10-01T05:00:00+00:00");
        assert_eq!(local_date(t, 420), day("2026-10-01"));
        assert_eq!(local_date(t, -600), day("2026-09-30"));
    }
}
