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
-- Keyset pagination for exports: (user_id, occurred_at, id) is a total order.
CREATE INDEX memos_user_occurred_id ON memos (user_id, occurred_at DESC, id DESC);
DROP INDEX memos_user_occurred;

-- Validated CSV rows waiting for the user to confirm an import. Unlogged: cheap to write, and
-- losing it in a crash only means re-running the preview.
CREATE UNLOGGED TABLE import_rows (
    import_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    line int NOT NULL,
    direction text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL,
    occurred_at timestamptz NOT NULL,
    category text,
    source text,
    to_source text,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_rows_import ON import_rows (import_id);
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "DROP TABLE import_rows;
                 CREATE INDEX memos_user_occurred ON memos (user_id, occurred_at DESC);
                 DROP INDEX memos_user_occurred_id;",
            )
            .await?;
        Ok(())
    }
}
