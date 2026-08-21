ALTER TABLE users
    ADD COLUMN deletion_requested_at TIMESTAMPTZ,
    ADD COLUMN deletion_due_at TIMESTAMPTZ,
    ADD COLUMN purge_started_at TIMESTAMPTZ,
    ADD COLUMN purge_claim_token TEXT,
    ADD COLUMN purge_claimed_until TIMESTAMPTZ;

CREATE INDEX users_deletion_purge_candidates_idx
    ON users (deletion_due_at, purge_started_at, id)
    WHERE status IN ('pending_deletion', 'purging');
