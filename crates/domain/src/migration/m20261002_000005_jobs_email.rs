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
-- Background work for apps/worker (email, CSV export/import). Claimed with FOR UPDATE SKIP LOCKED.
CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    kind text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    attempts int NOT NULL DEFAULT 0,
    run_after timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    error text,
    result jsonb,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queued ON jobs (kind, run_after) WHERE status = 'queued';
CREATE INDEX jobs_user ON jobs (user_id, kind, created_at DESC) WHERE user_id IS NOT NULL;

-- Single-use links for password reset and email change. Only the token's SHA-256 is stored.
CREATE TABLE email_tokens (
    token_hash bytea PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('reset', 'change_email')),
    new_email text CHECK (new_email = lower(new_email)),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user ON email_tokens (user_id, created_at DESC);
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP TABLE email_tokens, jobs")
            .await?;
        Ok(())
    }
}
