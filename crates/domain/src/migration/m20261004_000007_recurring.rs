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
-- A memo template that repeats. `anchor_day` is the day of month it aims for, so a rule on the
-- 31st clamps to Feb 28 and returns to Mar 31. Users have no stored timezone: `offset_minutes`
-- is the client's UTC offset at create/edit, used for "today" and the memo's local noon.
CREATE TABLE recurring_rules (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction text NOT NULL CHECK (direction IN ('income', 'expense', 'transfer')),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
    source_id uuid REFERENCES sources(id),
    to_source_id uuid REFERENCES sources(id),
    note text,
    cadence text NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'yearly')),
    anchor_day smallint NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
    next_date date NOT NULL,
    offset_minutes int NOT NULL CHECK (offset_minutes BETWEEN -1080 AND 1080),
    paused_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (direction = 'transfer') = (to_source_id IS NOT NULL)
        AND (direction <> 'transfer' OR (source_id IS NOT NULL AND source_id <> to_source_id AND category_id IS NULL))
    )
);
CREATE INDEX recurring_rules_user ON recurring_rules (user_id);
CREATE INDEX recurring_rules_due ON recurring_rules (next_date) WHERE paused_at IS NULL;

-- One memo per rule and occurrence, even if two materializers race or one re-runs.
ALTER TABLE memos ADD COLUMN recurring_rule_id uuid REFERENCES recurring_rules(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX memos_recurring_once ON memos (recurring_rule_id, occurred_at)
    WHERE recurring_rule_id IS NOT NULL;
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE memos DROP COLUMN recurring_rule_id;
                 DROP TABLE recurring_rules;",
            )
            .await?;
        Ok(())
    }
}
