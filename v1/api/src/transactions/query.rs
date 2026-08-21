use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::service::TransactionDirection;

const CURSOR_VERSION: u8 = 1;
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;
const MAX_CURSOR_LENGTH: usize = 512;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawHistoryQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(rename = "type")]
    pub transaction_type: Option<String>,
    pub wallet_id: Option<String>,
    pub category_id: Option<String>,
    pub q: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<String>,
}

#[derive(Debug)]
pub struct HistoryQuery {
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub transaction_type: Option<TransactionDirection>,
    pub wallet_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub escaped_query: Option<String>,
    pub cursor: Option<HistoryCursor>,
    pub limit: i64,
}

#[derive(Clone, Debug)]
pub struct HistoryCursor {
    pub occurred_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Debug)]
pub struct QueryError {
    pub field: &'static str,
}

impl RawHistoryQuery {
    pub fn parse(self) -> Result<HistoryQuery, QueryError> {
        let from = parse_instant(self.from, "from")?;
        let to = parse_instant(self.to, "to")?;
        if matches!((&from, &to), (Some(from), Some(to)) if from > to) {
            return Err(QueryError { field: "to" });
        }
        let transaction_type = self
            .transaction_type
            .map(|value| {
                TransactionDirection::parse(&value).map_err(|_| QueryError { field: "type" })
            })
            .transpose()?;
        let wallet_id = parse_uuid(self.wallet_id, "wallet_id")?;
        let category_id = parse_uuid(self.category_id, "category_id")?;
        let escaped_query = self
            .q
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if escaped_query
            .as_ref()
            .is_some_and(|value| value.chars().count() > 100)
        {
            return Err(QueryError { field: "q" });
        }
        let cursor = self
            .cursor
            .map(|value| HistoryCursor::decode(&value))
            .transpose()?;
        let limit = self
            .limit
            .map(|value| {
                value
                    .parse::<i64>()
                    .map_err(|_| QueryError { field: "limit" })
            })
            .transpose()?
            .unwrap_or(DEFAULT_LIMIT);
        if !(1..=MAX_LIMIT).contains(&limit) {
            return Err(QueryError { field: "limit" });
        }
        Ok(HistoryQuery {
            from,
            to,
            transaction_type,
            wallet_id,
            category_id,
            escaped_query: escaped_query.map(|value| escape_like(&value)),
            cursor,
            limit,
        })
    }
}

impl HistoryCursor {
    pub fn encode(&self) -> String {
        let payload = CursorPayload {
            version: CURSOR_VERSION,
            occurred_at: self.occurred_at.to_rfc3339(),
            id: self.id,
        };
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).expect("cursor payload serializes"))
    }

    fn decode(encoded: &str) -> Result<Self, QueryError> {
        if encoded.is_empty() || encoded.len() > MAX_CURSOR_LENGTH {
            return Err(QueryError { field: "cursor" });
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| QueryError { field: "cursor" })?;
        let payload: CursorPayload =
            serde_json::from_slice(&bytes).map_err(|_| QueryError { field: "cursor" })?;
        if payload.version != CURSOR_VERSION {
            return Err(QueryError { field: "cursor" });
        }
        let occurred_at = DateTime::parse_from_rfc3339(&payload.occurred_at)
            .map(|value| value.with_timezone(&Utc))
            .map_err(|_| QueryError { field: "cursor" })?;
        Ok(Self {
            occurred_at,
            id: payload.id,
        })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CursorPayload {
    version: u8,
    occurred_at: String,
    id: Uuid,
}

fn parse_instant(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<DateTime<Utc>>, QueryError> {
    value
        .map(|value| {
            DateTime::parse_from_rfc3339(value.trim())
                .map(|value| value.with_timezone(&Utc))
                .map_err(|_| QueryError { field })
        })
        .transpose()
}

fn parse_uuid(value: Option<String>, field: &'static str) -> Result<Option<Uuid>, QueryError> {
    value
        .map(|value| Uuid::parse_str(value.trim()).map_err(|_| QueryError { field }))
        .transpose()
}

pub fn escape_like(q: &str) -> String {
    q.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
