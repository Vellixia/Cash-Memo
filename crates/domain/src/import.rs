//! CSV import: turning one CSV record into a memo-shaped row, with the same rules as the API.
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};

use crate::money;

/// Which CSV column holds what (0-based), plus how to read amounts and dates.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Mapping {
    #[serde(default = "yes")]
    pub has_header: bool,
    pub date: usize,
    pub amount: usize,
    /// Without it, the amount's sign decides: negative = expense (typical bank export).
    pub direction: Option<usize>,
    pub currency: Option<usize>,
    pub category: Option<usize>,
    pub source: Option<usize>,
    pub to_source: Option<usize>,
    pub note: Option<usize>,
    /// Used when there's no currency column or a cell is empty.
    pub default_currency: String,
    #[serde(default = "dot")]
    pub decimal: char,
    #[serde(default)]
    pub date_order: DateOrder,
    /// Minutes east of UTC, for dates without a time zone.
    #[serde(default)]
    pub offset: i32,
}

fn yes() -> bool {
    true
}
fn dot() -> char {
    '.'
}

/// How to read ambiguous dates like 03/04/2026.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DateOrder {
    #[default]
    Dmy,
    Mdy,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub direction: String,
    pub amount_minor: i64,
    pub currency: String,
    pub occurred_at: DateTime<Utc>,
    pub category: Option<String>,
    pub source: Option<String>,
    pub to_source: Option<String>,
    pub note: Option<String>,
}

pub fn parse_row(fields: &[&str], m: &Mapping) -> Result<Row, String> {
    let cell = |i: Option<usize>| {
        i.and_then(|i| fields.get(i))
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
    };
    let name = |i: Option<usize>, what: &str| -> Result<Option<String>, String> {
        match cell(i) {
            Some(n) if n.chars().count() > 100 => {
                Err(format!("{what} name is longer than 100 characters"))
            }
            n => Ok(n.map(str::to_owned)),
        }
    };

    let currency = cell(m.currency)
        .unwrap_or(&m.default_currency)
        .to_uppercase();
    if currency.len() != 3 || !currency.chars().all(|c| c.is_ascii_uppercase()) {
        return Err(format!("\"{currency}\" is not a 3-letter currency code"));
    }
    let raw_amount = cell(Some(m.amount)).ok_or("amount is empty")?;
    let signed = money::parse_decimal(raw_amount, &currency, m.decimal).map_err(str::to_owned)?;
    if signed == 0 {
        return Err("amount is zero".into());
    }
    let direction = match cell(m.direction) {
        None => if signed < 0 { "expense" } else { "income" }.to_owned(),
        Some(d) => match d.to_lowercase().as_str() {
            "income" | "in" | "credit" | "cr" | "+" => "income".to_owned(),
            "expense" | "out" | "debit" | "db" | "dr" | "-" => "expense".to_owned(),
            "transfer" => "transfer".to_owned(),
            other => return Err(format!("\"{other}\" is not income, expense or transfer")),
        },
    };
    let occurred_at = parse_date(cell(Some(m.date)).ok_or("date is empty")?, m)?;
    let (source, to_source) = (name(m.source, "source")?, name(m.to_source, "to source")?);
    let category = name(m.category, "category")?;
    if direction == "transfer" {
        match (&source, &to_source) {
            (Some(a), Some(b)) if a != b => {}
            _ => return Err("a transfer needs two different sources".into()),
        }
    }
    let note = cell(m.note).map(str::to_owned);
    if note.as_ref().is_some_and(|n| n.chars().count() > 2000) {
        return Err("note is longer than 2000 characters".into());
    }
    Ok(Row {
        category: if direction == "transfer" {
            None
        } else {
            category
        },
        to_source: if direction == "transfer" {
            to_source
        } else {
            None
        },
        direction,
        amount_minor: signed.abs(),
        currency,
        occurred_at,
        source,
        note,
    })
}

/// RFC 3339, ISO dates/times, or day/month/year (per `date_order`) with `/`, `-` or `.`.
/// Values without a time zone are read in the mapping's offset; date-only values at 12:00.
fn parse_date(s: &str, m: &Mapping) -> Result<DateTime<Utc>, String> {
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Ok(t.with_timezone(&Utc));
    }
    let tz = FixedOffset::east_opt(m.offset.saturating_mul(60)).ok_or("invalid offset")?;
    let noon = NaiveTime::from_hms_opt(12, 0, 0).unwrap();
    let naive = ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"]
        .iter()
        .find_map(|f| NaiveDateTime::parse_from_str(s, f).ok())
        .or_else(|| {
            let (day_first, month_first) = ("%d{}%m{}%Y", "%m{}%d{}%Y");
            let pattern = if m.date_order == DateOrder::Mdy {
                month_first
            } else {
                day_first
            };
            std::iter::once("%Y-%m-%d".to_owned())
                .chain(["/", "-", "."].map(|sep| pattern.replace("{}", sep)))
                .find_map(|f| NaiveDate::parse_from_str(s, &f).ok())
                .map(|d| d.and_time(noon))
        })
        .ok_or_else(|| format!("\"{s}\" is not a date I can read"))?;
    naive
        .and_local_timezone(tz)
        .single()
        .map(|t| t.with_timezone(&Utc))
        .ok_or_else(|| format!("\"{s}\" is not a valid local time"))
}

/// Guards spreadsheet apps against formula injection in exported text cells.
pub fn csv_safe(text: &str) -> String {
    if text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{text}")
    } else {
        text.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping() -> Mapping {
        serde_json::from_value(serde_json::json!({
            "date": 0, "amount": 1, "direction": 2, "currency": 3, "category": 4,
            "source": 5, "to_source": 6, "note": 7, "default_currency": "USD", "offset": 420
        }))
        .unwrap()
    }

    #[test]
    fn reads_our_own_export() {
        let r = parse_row(
            &[
                "2026-09-10T19:00:00+07:00",
                "12.50",
                "expense",
                "USD",
                "Food",
                "Cash",
                "",
                " lunch ",
            ],
            &mapping(),
        )
        .unwrap();
        assert_eq!(r.occurred_at.to_rfc3339(), "2026-09-10T12:00:00+00:00");
        assert_eq!((r.direction.as_str(), r.amount_minor), ("expense", 1250));
        assert_eq!(
            (
                r.category.as_deref(),
                r.source.as_deref(),
                r.note.as_deref()
            ),
            (Some("Food"), Some("Cash"), Some("lunch"))
        );
    }

    #[test]
    fn bank_style_signs_dates_and_words() {
        let m = Mapping {
            direction: None,
            currency: None,
            default_currency: "IDR".into(),
            decimal: ',',
            ..mapping()
        };
        let r = parse_row(&["03/04/2026", "-45.000"], &m).unwrap();
        assert_eq!(
            (r.direction.as_str(), r.amount_minor, r.currency.as_str()),
            ("expense", 45_000, "IDR")
        );
        // Date-only, day first, at local noon (+07:00).
        assert_eq!(r.occurred_at.to_rfc3339(), "2026-04-03T05:00:00+00:00");
        let r = parse_row(
            &["03/04/2026", "1.000.000"],
            &Mapping {
                date_order: DateOrder::Mdy,
                ..m
            },
        )
        .unwrap();
        assert_eq!(
            (r.direction.as_str(), r.occurred_at.date_naive().to_string()),
            ("income", "2026-03-04".into())
        );

        let r = parse_row(&["2026-01-01", "10", "Debit", "usd"], &mapping()).unwrap();
        assert_eq!(
            (r.direction.as_str(), r.currency.as_str()),
            ("expense", "USD")
        );
    }

    #[test]
    fn rejects_bad_rows_with_a_reason() {
        let m = mapping();
        for (row, why) in [
            (vec!["2026-01-01", "0", "expense"], "zero"),
            (vec!["nope", "1", "expense"], "date"),
            (vec!["2026-01-01", "1.234", "expense", "USD"], "decimals"),
            (vec!["2026-01-01", "1", "gift"], "direction"),
            (vec!["2026-01-01", "1", "expense", "dollars"], "currency"),
            (
                vec!["2026-01-01", "1", "transfer", "USD", "", "BCA", "BCA"],
                "transfer",
            ),
        ] {
            assert!(parse_row(&row, &m).is_err(), "{why}");
        }
        // Transfers drop the category; income/expense drop the destination.
        let r = parse_row(
            &["2026-01-01", "5", "transfer", "USD", "Food", "BCA", "Visa"],
            &m,
        )
        .unwrap();
        assert_eq!((r.category, r.to_source.as_deref()), (None, Some("Visa")));
        let r = parse_row(&["2026-01-01", "5", "income", "USD", "", "BCA", "Visa"], &m).unwrap();
        assert_eq!(r.to_source, None);
    }

    #[test]
    fn neutralizes_formulas() {
        assert_eq!(csv_safe("=SUM(A1)"), "'=SUM(A1)");
        assert_eq!(csv_safe("Lunch"), "Lunch");
    }
}
