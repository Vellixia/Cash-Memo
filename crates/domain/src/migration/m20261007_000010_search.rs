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
-- Trusted since PG 13; the DB owner can create it without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fuzzy/substring search over notes (ILIKE '%q%'); non-deleted memos only, matching the app's queries.
CREATE INDEX memos_note_trgm ON memos USING gin (note gin_trgm_ops) WHERE deleted_at IS NULL;
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP INDEX memos_note_trgm;")
            .await?;
        Ok(())
    }
}
