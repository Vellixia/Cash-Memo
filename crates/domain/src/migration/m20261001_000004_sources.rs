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
CREATE TABLE sources (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    kind text NOT NULL CHECK (kind IN ('cash', 'bank', 'ewallet', 'credit', 'paylater', 'other')),
    emoji text CHECK (length(emoji) <= 8),
    track_balance boolean NOT NULL DEFAULT false,
    currency char(3) CHECK (currency ~ '^[A-Z]{3}$'),
    opening_minor bigint NOT NULL DEFAULT 0,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name),
    CHECK (NOT track_balance OR currency IS NOT NULL)
);

-- Everyone starts with Cash, so a required source never blocks the first expense.
INSERT INTO sources (id, user_id, name, kind, emoji)
SELECT gen_random_uuid(), id, 'Cash', 'cash', '💵' FROM users;

ALTER TABLE memos
    ADD COLUMN source_id uuid REFERENCES sources(id),
    ADD COLUMN to_source_id uuid REFERENCES sources(id),
    DROP CONSTRAINT memos_direction_check,
    ADD CONSTRAINT memos_direction_check CHECK (direction IN ('income', 'expense', 'transfer')),
    ADD CONSTRAINT memos_transfer_check CHECK (
        (direction = 'transfer') = (to_source_id IS NOT NULL)
        AND (direction <> 'transfer' OR (source_id IS NOT NULL AND source_id <> to_source_id AND category_id IS NULL))
    );
CREATE INDEX memos_source ON memos (source_id) WHERE source_id IS NOT NULL;
CREATE INDEX memos_to_source ON memos (to_source_id) WHERE to_source_id IS NOT NULL;
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
DELETE FROM memos WHERE direction = 'transfer';
ALTER TABLE memos
    DROP CONSTRAINT memos_transfer_check,
    DROP CONSTRAINT memos_direction_check,
    ADD CONSTRAINT memos_direction_check CHECK (direction IN ('income', 'expense')),
    DROP COLUMN to_source_id,
    DROP COLUMN source_id;
DROP TABLE sources;
"#,
            )
            .await?;
        Ok(())
    }
}
