use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "-- One optional receipt/photo per memo; the object itself lives in R2/RustFS
                 -- under `attachments/<user_id>/<memo_id>/`, never under `users/` (see
                 -- domain::storage::attachment_prefix).
                 ALTER TABLE memos ADD COLUMN attachment_key text",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE memos DROP COLUMN attachment_key")
            .await?;
        Ok(())
    }
}
