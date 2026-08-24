ALTER TABLE users
    ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sessions
    ADD CONSTRAINT sessions_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE auth_tokens
    ADD CONSTRAINT auth_tokens_token_hash_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX sessions_active_token_lookup
    ON sessions (token_hash) WHERE revoked_at IS NULL;

CREATE INDEX auth_tokens_cleanup_expiry
    ON auth_tokens (expires_at, id);
