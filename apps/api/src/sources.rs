use axum::{Router, extract::State, http::StatusCode, routing::get};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, DbBackend, EntityTrait, FromQueryResult,
    IntoActiveModel, PaginatorTrait, QueryFilter, QueryOrder, Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    categories::{valid_emoji, valid_name},
    entities::{memo, source},
    error::{AppError, Json, Path, Result},
    memos::present,
    parse_currency,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sources", get(list).post(create))
        .route("/sources/{id}", axum::routing::patch(update).delete(remove))
}

#[derive(Deserialize)]
struct SourceIn {
    name: String,
    kind: String,
    emoji: Option<String>,
    #[serde(default)]
    track_balance: bool,
    currency: Option<String>,
    #[serde(default)]
    opening_minor: i64,
}

#[derive(Deserialize)]
struct UpdateIn {
    name: Option<String>,
    kind: Option<String>,
    #[serde(default, deserialize_with = "present")]
    emoji: Option<Option<String>>,
    track_balance: Option<bool>,
    #[serde(default, deserialize_with = "present")]
    currency: Option<Option<String>>,
    opening_minor: Option<i64>,
    archived: Option<bool>,
}

#[derive(Serialize)]
struct SourceOut {
    #[serde(flatten)]
    source: source::Model,
    /// Only for sources that track a balance.
    balance_minor: Option<i64>,
}

#[derive(FromQueryResult)]
struct Balance {
    id: Uuid,
    balance_minor: i64,
}

async fn list(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
) -> Result<Json<Vec<SourceOut>>> {
    let all = source::Entity::find()
        .filter(source::Column::UserId.eq(uid))
        .order_by_asc(source::Column::CreatedAt)
        .all(&st.db)
        .await?;
    // Opening + income − expense − transfers out + transfers in, for tracked sources only.
    let balances: HashMap<Uuid, i64> = Balance::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT s.id, (s.opening_minor + COALESCE(SUM(
             CASE WHEN m.to_source_id = s.id THEN m.amount_minor
                  WHEN m.direction = 'income' THEN m.amount_minor
                  ELSE -m.amount_minor END), 0))::bigint AS balance_minor
         FROM sources s
         LEFT JOIN memos m ON m.user_id = s.user_id AND m.deleted_at IS NULL
              AND (m.source_id = s.id OR m.to_source_id = s.id)
         WHERE s.user_id = $1 AND s.track_balance
         GROUP BY s.id",
        [uid.into()],
    ))
    .all(&st.db)
    .await?
    .into_iter()
    .map(|b| (b.id, b.balance_minor))
    .collect();
    Ok(Json(
        all.into_iter()
            .map(|s| SourceOut {
                balance_minor: balances.get(&s.id).copied(),
                source: s,
            })
            .collect(),
    ))
}

async fn create(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<SourceIn>,
) -> Result<(StatusCode, Json<SourceOut>)> {
    let currency = input.currency.as_deref().map(parse_currency).transpose()?;
    if input.track_balance && currency.is_none() {
        return Err(AppError::BadRequest("tracking a balance needs a currency"));
    }
    let s = source::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(uid),
        name: Set(valid_name(&input.name)?),
        kind: Set(parse_kind(&input.kind)?),
        emoji: Set(valid_emoji(input.emoji)?),
        track_balance: Set(input.track_balance),
        currency: Set(currency),
        opening_minor: Set(input.opening_minor),
        archived_at: Set(None),
        created_at: Set(Utc::now()),
    }
    .insert(&st.db)
    .await?;
    let balance_minor = s.track_balance.then_some(s.opening_minor);
    Ok((
        StatusCode::CREATED,
        Json(SourceOut {
            source: s,
            balance_minor,
        }),
    ))
}

async fn update(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateIn>,
) -> Result<Json<source::Model>> {
    let txn = st.db.begin().await?;
    let mut s = owned(&txn, uid, id).await?.into_active_model();
    if let Some(name) = input.name {
        s.name = Set(valid_name(&name)?);
    }
    if let Some(kind) = input.kind {
        s.kind = Set(parse_kind(&kind)?);
    }
    if let Some(emoji) = input.emoji {
        s.emoji = Set(valid_emoji(emoji)?);
    }
    if let Some(t) = input.track_balance {
        s.track_balance = Set(t);
    }
    if let Some(c) = input.currency {
        s.currency = Set(c.as_deref().map(parse_currency).transpose()?);
    }
    if let Some(o) = input.opening_minor {
        s.opening_minor = Set(o);
    }
    if let Some(archived) = input.archived {
        if archived {
            keep_one_active(&txn, uid, id).await?;
        }
        s.archived_at = Set(archived.then(Utc::now));
    }
    if let Some(cur) = s.currency.as_ref() {
        // A currency lock must hold for the memos already on this source.
        let mismatched = memo::Entity::find()
            .filter(memo::Column::DeletedAt.is_null())
            .filter(
                Condition::any()
                    .add(memo::Column::SourceId.eq(id))
                    .add(memo::Column::ToSourceId.eq(id)),
            )
            .filter(memo::Column::Currency.ne(cur.as_str()))
            .count(&txn)
            .await?;
        if mismatched > 0 {
            return Err(AppError::BadRequest(
                "this source already has memos in another currency",
            ));
        }
    } else if *s.track_balance.as_ref() {
        return Err(AppError::BadRequest("tracking a balance needs a currency"));
    }
    let s = s.update(&txn).await?;
    txn.commit().await?;
    Ok(Json(s))
}

/// Archives rather than deletes, so history and balances stay intact.
async fn remove(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    let txn = st.db.begin().await?;
    let mut s = owned(&txn, uid, id).await?.into_active_model();
    keep_one_active(&txn, uid, id).await?;
    s.archived_at = Set(Some(Utc::now()));
    s.update(&txn).await?;
    txn.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn owned(db: &impl sea_orm::ConnectionTrait, uid: Uuid, id: Uuid) -> Result<source::Model> {
    source::Entity::find_by_id(id)
        .filter(source::Column::UserId.eq(uid))
        .one(db)
        .await?
        .ok_or(AppError::NotFound)
}

/// Expenses need a source, so the last active one can't be archived.
async fn keep_one_active(db: &impl sea_orm::ConnectionTrait, uid: Uuid, id: Uuid) -> Result<()> {
    let others = source::Entity::find()
        .filter(source::Column::UserId.eq(uid))
        .filter(source::Column::ArchivedAt.is_null())
        .filter(source::Column::Id.ne(id))
        .count(db)
        .await?;
    if others == 0 {
        return Err(AppError::BadRequest("keep at least one active source"));
    }
    Ok(())
}

fn parse_kind(k: &str) -> Result<String> {
    match k {
        "cash" | "bank" | "ewallet" | "credit" | "paylater" | "other" => Ok(k.to_owned()),
        _ => Err(AppError::BadRequest(
            "kind must be cash, bank, ewallet, credit, paylater or other",
        )),
    }
}

/// The starter source every account gets at sign-up.
pub(crate) async fn create_cash(db: &impl sea_orm::ConnectionTrait, uid: Uuid) -> Result<()> {
    source::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(uid),
        name: Set("Cash".to_owned()),
        kind: Set("cash".to_owned()),
        emoji: Set(Some("💵".to_owned())),
        track_balance: Set(false),
        currency: Set(None),
        opening_minor: Set(0),
        archived_at: Set(None),
        created_at: Set(Utc::now()),
    }
    .insert(db)
    .await?;
    Ok(())
}
