//! Monthly spending limits per expense category and currency.
use axum::{Router, extract::State, http::StatusCode, routing::get};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbBackend, EntityTrait, FromQueryResult, IntoActiveModel,
    QueryFilter, Set, Statement,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::CurrentUser,
    entities::{budget, category},
    error::{AppError, Json, Path, Query, Result},
    memos::month_range,
    parse_currency, recurring,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/budgets", get(list).post(create))
        .route("/budgets/{id}", axum::routing::patch(update).delete(remove))
}

#[derive(Deserialize)]
struct MonthQuery {
    /// Defaults to the current local month.
    month: Option<String>,
    #[serde(default)]
    offset: i32,
}

#[derive(Serialize)]
struct BudgetMonth {
    #[serde(flatten)]
    budget: budget::Model,
    /// Expenses of that category and currency in the month.
    spent_minor: i64,
    /// `spent_minor` plus recurring expenses still to come this month.
    projected_minor: i64,
}

#[derive(FromQueryResult)]
struct Spent {
    category_id: Uuid,
    currency: String,
    total_minor: i64,
}

async fn list(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Query(q): Query<MonthQuery>,
) -> Result<Json<Vec<BudgetMonth>>> {
    let month = match q.month {
        Some(m) => m,
        None => domain::recurring::local_date(Utc::now(), q.offset)
            .format("%Y-%m")
            .to_string(),
    };
    let (start, end) = month_range(&month, q.offset)?;
    let budgets = budget::Entity::find()
        .filter(budget::Column::UserId.eq(uid))
        .all(&st.db)
        .await?;
    let spent = Spent::find_by_statement(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT category_id, currency::text AS currency, SUM(amount_minor)::bigint AS total_minor
         FROM memos
         WHERE user_id = $1 AND deleted_at IS NULL AND direction = 'expense'
           AND category_id IS NOT NULL AND occurred_at >= $2 AND occurred_at < $3
         GROUP BY category_id, currency",
        [uid.into(), start.into(), end.into()],
    ))
    .all(&st.db)
    .await?;
    let pending = recurring::pending(&st, uid, &month).await?;
    let out = budgets
        .into_iter()
        .map(|b| {
            let matches =
                |c: Option<Uuid>, cur: &str| c == Some(b.category_id) && cur == b.currency;
            let spent_minor = spent
                .iter()
                .find(|s| matches(Some(s.category_id), &s.currency))
                .map_or(0, |s| s.total_minor);
            let coming: i64 = pending
                .iter()
                .filter(|(r, _)| r.direction == "expense" && matches(r.category_id, &r.currency))
                .map(|(r, dates)| r.amount_minor * dates.len() as i64)
                .sum();
            BudgetMonth {
                budget: b,
                spent_minor,
                projected_minor: spent_minor + coming,
            }
        })
        .collect();
    Ok(Json(out))
}

#[derive(Deserialize)]
struct BudgetIn {
    category_id: Uuid,
    currency: String,
    limit_minor: i64,
}

async fn create(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Json(input): Json<BudgetIn>,
) -> Result<(StatusCode, Json<budget::Model>)> {
    let c = category::Entity::find_by_id(input.category_id)
        .filter(category::Column::UserId.eq(uid))
        .one(&st.db)
        .await?
        .ok_or(AppError::BadRequest("unknown category"))?;
    if c.direction != "expense" {
        return Err(AppError::BadRequest("budgets are for expense categories"));
    }
    let b = budget::ActiveModel {
        id: Set(Uuid::new_v4()),
        user_id: Set(uid),
        category_id: Set(c.id),
        currency: Set(parse_currency(&input.currency)?),
        limit_minor: Set(valid_limit(input.limit_minor)?),
        created_at: Set(Utc::now()),
    }
    .insert(&st.db)
    .await?;
    Ok((StatusCode::CREATED, Json(b)))
}

#[derive(Deserialize)]
struct UpdateIn {
    limit_minor: i64,
}

async fn update(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateIn>,
) -> Result<Json<budget::Model>> {
    let mut b = budget::Entity::find_by_id(id)
        .filter(budget::Column::UserId.eq(uid))
        .one(&st.db)
        .await?
        .ok_or(AppError::NotFound)?
        .into_active_model();
    b.limit_minor = Set(valid_limit(input.limit_minor)?);
    Ok(Json(b.update(&st.db).await?))
}

async fn remove(
    State(st): State<AppState>,
    CurrentUser(uid): CurrentUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    let res = budget::Entity::delete_many()
        .filter(budget::Column::Id.eq(id))
        .filter(budget::Column::UserId.eq(uid))
        .exec(&st.db)
        .await?;
    if res.rows_affected == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

fn valid_limit(l: i64) -> Result<i64> {
    (l > 0)
        .then_some(l)
        .ok_or(AppError::BadRequest("limit_minor must be positive"))
}
