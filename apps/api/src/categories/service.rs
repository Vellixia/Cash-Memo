use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone)]
pub struct CategoryService {
    pool: PgPool,
}

#[derive(Debug, Error)]
pub enum CategoryError {
    #[error("category was not found")]
    NotFound,
    #[error("category has references")]
    HasReferences,
    #[error("category name is invalid")]
    InvalidName,
    #[error("category kind is invalid")]
    InvalidKind,
    #[error("category name conflicts with an active category")]
    NameConflict,
    #[error("category update has no changes")]
    NoChanges,
    #[error("category persistence failed")]
    Persistence,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryKind {
    Income,
    Expense,
}

impl CategoryKind {
    pub fn parse(value: &str) -> Result<Self, CategoryError> {
        match value {
            "income" => Ok(Self::Income),
            "expense" => Ok(Self::Expense),
            _ => Err(CategoryError::InvalidKind),
        }
    }

    fn database_value(self) -> &'static str {
        match self {
            Self::Income => "INCOME",
            Self::Expense => "EXPENSE",
        }
    }

    fn from_database(value: &str) -> Result<Self, CategoryError> {
        match value {
            "INCOME" => Ok(Self::Income),
            "EXPENSE" => Ok(Self::Expense),
            _ => Err(CategoryError::Persistence),
        }
    }
}

#[derive(Debug)]
pub struct NewCategory {
    pub name: String,
    pub kind: String,
}

#[derive(Debug)]
pub struct UpdateCategory {
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Category {
    pub id: Uuid,
    pub name: String,
    pub kind: CategoryKind,
    pub archived_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArchiveResult {
    #[serde(flatten)]
    pub category: Category,
    pub paused_recurring_count: u64,
}

#[derive(FromRow)]
struct CategoryRow {
    id: Uuid,
    name: String,
    transaction_type: String,
    archived_at: Option<DateTime<Utc>>,
}

impl CategoryService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self, user_id: Uuid) -> Result<Vec<Category>, CategoryError> {
        let rows = sqlx::query_as::<_, CategoryRow>(
            "SELECT id, name, transaction_type::TEXT AS transaction_type, archived_at
             FROM categories
             WHERE user_id = $1
             ORDER BY archived_at NULLS FIRST, transaction_type, normalized_name, id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|_| CategoryError::Persistence)?;
        rows.into_iter().map(Category::try_from).collect()
    }

    pub async fn create(
        &self,
        user_id: Uuid,
        input: NewCategory,
    ) -> Result<Category, CategoryError> {
        let (name, normalized_name) = normalize_category_name(&input.name)?;
        let kind = CategoryKind::parse(&input.kind)?;
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, name, normalized_name, transaction_type)
             VALUES ($1, $2, $3, $4::transaction_type) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .bind(normalized_name)
        .bind(kind.database_value())
        .fetch_one(&self.pool)
        .await
        .map_err(map_database_error)?;
        self.load(user_id, id).await
    }

    pub async fn update(
        &self,
        user_id: Uuid,
        category_id: Uuid,
        input: UpdateCategory,
    ) -> Result<Category, CategoryError> {
        let Some(input_name) = input.name else {
            return Err(CategoryError::NoChanges);
        };
        let (name, normalized_name) = normalize_category_name(&input_name)?;
        let updated = sqlx::query(
            "UPDATE categories
             SET name = $3, normalized_name = $4, updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(category_id)
        .bind(name)
        .bind(normalized_name)
        .execute(&self.pool)
        .await
        .map_err(map_database_error)?;
        if updated.rows_affected() == 0 {
            return Err(CategoryError::NotFound);
        }
        self.load(user_id, category_id).await
    }

    pub async fn archive(
        &self,
        user_id: Uuid,
        category_id: Uuid,
    ) -> Result<ArchiveResult, CategoryError> {
        let mut database = self
            .pool
            .begin()
            .await
            .map_err(|_| CategoryError::Persistence)?;
        let exists: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM categories WHERE user_id = $1 AND id = $2 FOR UPDATE",
        )
        .bind(user_id)
        .bind(category_id)
        .fetch_optional(&mut *database)
        .await
        .map_err(|_| CategoryError::Persistence)?;
        if exists.is_none() {
            return Err(CategoryError::NotFound);
        }
        sqlx::query(
            "UPDATE categories
             SET archived_at = COALESCE(archived_at, now()), updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(category_id)
        .execute(&mut *database)
        .await
        .map_err(|_| CategoryError::Persistence)?;
        let paused = sqlx::query("UPDATE recurring_transactions SET status = 'paused', updated_at = now() WHERE user_id = $1 AND category_id = $2 AND status = 'active'")
            .bind(user_id).bind(category_id).execute(&mut *database).await.map_err(|_| CategoryError::Persistence)?;
        database
            .commit()
            .await
            .map_err(|_| CategoryError::Persistence)?;
        Ok(ArchiveResult {
            category: self.load(user_id, category_id).await?,
            paused_recurring_count: paused.rows_affected(),
        })
    }

    pub async fn restore(
        &self,
        user_id: Uuid,
        category_id: Uuid,
    ) -> Result<Category, CategoryError> {
        let updated = sqlx::query(
            "UPDATE categories SET archived_at = NULL, updated_at = now()
             WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(category_id)
        .execute(&self.pool)
        .await
        .map_err(map_database_error)?;
        if updated.rows_affected() == 0 {
            return Err(CategoryError::NotFound);
        }
        self.load(user_id, category_id).await
    }

    pub async fn delete(&self, user_id: Uuid, category_id: Uuid) -> Result<(), CategoryError> {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM categories WHERE user_id = $1 AND id = $2)",
        )
        .bind(user_id)
        .bind(category_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|_| CategoryError::Persistence)?;
        if !exists {
            return Err(CategoryError::NotFound);
        }
        let deleted = sqlx::query(
            "DELETE FROM categories c
             WHERE c.user_id = $1 AND c.id = $2
               AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = c.user_id AND t.category_id = c.id)
               AND NOT EXISTS (SELECT 1 FROM budgets b WHERE b.user_id = c.user_id AND b.category_id = c.id)
               AND NOT EXISTS (SELECT 1 FROM recurring_transactions r WHERE r.user_id = c.user_id AND r.category_id = c.id)",
        )
        .bind(user_id)
        .bind(category_id)
        .execute(&self.pool)
        .await
        .map_err(|_| CategoryError::Persistence)?;
        if deleted.rows_affected() == 0 {
            return Err(CategoryError::HasReferences);
        }
        Ok(())
    }

    async fn load(&self, user_id: Uuid, category_id: Uuid) -> Result<Category, CategoryError> {
        let row = sqlx::query_as::<_, CategoryRow>(
            "SELECT id, name, transaction_type::TEXT AS transaction_type, archived_at
             FROM categories WHERE user_id = $1 AND id = $2",
        )
        .bind(user_id)
        .bind(category_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| CategoryError::Persistence)?
        .ok_or(CategoryError::NotFound)?;
        Category::try_from(row)
    }
}

impl TryFrom<CategoryRow> for Category {
    type Error = CategoryError;

    fn try_from(row: CategoryRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            name: row.name,
            kind: CategoryKind::from_database(&row.transaction_type)?,
            archived_at: row.archived_at.map(|time| time.to_rfc3339()),
        })
    }
}

pub fn normalize_category_name(input: &str) -> Result<(String, String), CategoryError> {
    let display = input.trim();
    if !(1..=80).contains(&display.chars().count()) {
        return Err(CategoryError::InvalidName);
    }
    Ok((display.to_owned(), display.to_lowercase()))
}

fn map_database_error(error: sqlx::Error) -> CategoryError {
    match error
        .as_database_error()
        .and_then(|database| database.code())
    {
        Some(code) if code == "23505" => CategoryError::NameConflict,
        _ => CategoryError::Persistence,
    }
}
