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
ALTER TABLE sources
    ADD COLUMN credit_limit_minor bigint CHECK (credit_limit_minor > 0),
    ADD COLUMN statement_day smallint CHECK (statement_day BETWEEN 1 AND 31),
    ADD COLUMN due_day smallint CHECK (due_day BETWEEN 1 AND 31);

CREATE TABLE installment_plans (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id uuid NOT NULL REFERENCES sources(id),
    category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
    note text,
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    principal_minor bigint NOT NULL CHECK (principal_minor > 0),
    fee_minor bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    months smallint NOT NULL CHECK (months BETWEEN 2 AND 36),
    first_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- SET NULL (not CASCADE): cancelling a plan removes the plan row but its past memos stay put.
ALTER TABLE memos ADD COLUMN installment_plan_id uuid REFERENCES installment_plans(id) ON DELETE SET NULL;
CREATE INDEX memos_installment_plan ON memos (installment_plan_id) WHERE installment_plan_id IS NOT NULL;
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r#"
ALTER TABLE memos DROP COLUMN installment_plan_id;
DROP TABLE installment_plans;
ALTER TABLE sources DROP COLUMN due_day, DROP COLUMN statement_day, DROP COLUMN credit_limit_minor;
"#,
            )
            .await?;
        Ok(())
    }
}
