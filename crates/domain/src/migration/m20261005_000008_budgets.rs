use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r#"
-- A monthly spending limit per expense category and currency.
CREATE TABLE budgets (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    limit_minor bigint NOT NULL CHECK (limit_minor > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (category_id, currency)
);
CREATE INDEX budgets_user ON budgets (user_id);
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP TABLE budgets")
            .await?;
        Ok(())
    }
}
