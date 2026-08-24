CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('pending_verification', 'active', 'pending_deletion', 'purging');
CREATE TYPE auth_token_purpose AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE transaction_type AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE recurrence_frequency AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
CREATE TYPE recurring_status AS ENUM ('active', 'paused');

CREATE TABLE currencies (
    code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    exponent INTEGER NOT NULL CHECK (exponent BETWEEN 0 AND 4),
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO currencies (code, display_name, exponent, enabled) VALUES
    ('IDR', 'Indonesian Rupiah', 0, TRUE),
    ('USD', 'US Dollar', 2, TRUE),
    ('EUR', 'Euro', 2, TRUE);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
    password_hash TEXT NOT NULL,
    status user_status NOT NULL DEFAULT 'pending_verification',
    timezone TEXT NOT NULL DEFAULT 'Etc/UTC',
    default_currency_code TEXT REFERENCES currencies(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    UNIQUE (user_id, id),
    CHECK (expires_at > created_at)
);

CREATE TABLE auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    purpose auth_token_purpose NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX auth_tokens_one_active_per_purpose
    ON auth_tokens (user_id, purpose) WHERE consumed_at IS NULL;

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    currency_code TEXT NOT NULL REFERENCES currencies(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
    opening_balance NUMERIC(20,4) NOT NULL DEFAULT 0
        CHECK (
            opening_balance NOT IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
            AND opening_balance >= 0
        ),
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, id)
);

CREATE FUNCTION reject_wallet_currency_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
        RAISE EXCEPTION 'wallet currency is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER wallets_currency_immutable
    BEFORE UPDATE OF currency_code ON wallets
    FOR EACH ROW EXECUTE FUNCTION reject_wallet_currency_change();

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    transaction_type transaction_type NOT NULL,
    starter_key TEXT,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, id),
    UNIQUE (id, user_id, transaction_type),
    CHECK (normalized_name = lower(trim(normalized_name)))
);

CREATE UNIQUE INDEX categories_active_name_unique
    ON categories (user_id, transaction_type, normalized_name) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX categories_starter_key_unique
    ON categories (user_id, starter_key) WHERE starter_key IS NOT NULL;

CREATE TABLE recurring_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL,
    category_id UUID NOT NULL,
    transaction_type transaction_type NOT NULL,
    amount NUMERIC(20,4) NOT NULL
        CHECK (amount NOT IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC) AND amount > 0),
    note TEXT,
    frequency recurrence_frequency NOT NULL,
    start_date DATE NOT NULL,
    next_due_date DATE NOT NULL,
    status recurring_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, id),
    FOREIGN KEY (wallet_id, user_id) REFERENCES wallets (id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (category_id, user_id, transaction_type)
        REFERENCES categories (id, user_id, transaction_type) ON DELETE RESTRICT
);

CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID NOT NULL,
    category_type transaction_type NOT NULL DEFAULT 'EXPENSE' CHECK (category_type = 'EXPENSE'),
    currency_code TEXT NOT NULL REFERENCES currencies(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
    month_start DATE NOT NULL CHECK (EXTRACT(DAY FROM month_start) = 1),
    amount NUMERIC(20,4) NOT NULL
        CHECK (amount NOT IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC) AND amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, id),
    UNIQUE (user_id, category_id, currency_code, month_start),
    FOREIGN KEY (category_id, user_id, category_type)
        REFERENCES categories (id, user_id, transaction_type) ON DELETE RESTRICT
);

CREATE FUNCTION reject_referenced_currency_disable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.enabled AND NOT NEW.enabled AND (
        EXISTS (SELECT 1 FROM users WHERE default_currency_code = OLD.code)
        OR EXISTS (SELECT 1 FROM wallets WHERE currency_code = OLD.code)
        OR EXISTS (SELECT 1 FROM budgets WHERE currency_code = OLD.code)
    ) THEN
        RAISE EXCEPTION 'referenced currency cannot be disabled';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER currencies_referenced_rows_stay_enabled
    BEFORE UPDATE OF enabled ON currencies
    FOR EACH ROW EXECUTE FUNCTION reject_referenced_currency_disable();

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL,
    category_id UUID NOT NULL,
    transaction_type transaction_type NOT NULL,
    amount NUMERIC(20,4) NOT NULL
        CHECK (amount NOT IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC) AND amount > 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    note TEXT,
    deleted_at TIMESTAMPTZ,
    purge_after TIMESTAMPTZ,
    recurring_occurrence_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, id),
    FOREIGN KEY (wallet_id, user_id) REFERENCES wallets (id, user_id) ON DELETE RESTRICT,
    FOREIGN KEY (category_id, user_id, transaction_type)
        REFERENCES categories (id, user_id, transaction_type) ON DELETE RESTRICT,
    CHECK (
        (deleted_at IS NULL AND purge_after IS NULL)
        OR (
            deleted_at IS NOT NULL
            AND purge_after IS NOT NULL
            AND purge_after = deleted_at + INTERVAL '30 days'
        )
    )
);

CREATE TABLE recurring_occurrences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recurring_transaction_id UUID NOT NULL,
    scheduled_for DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, id),
    UNIQUE (recurring_transaction_id, scheduled_for),
    FOREIGN KEY (recurring_transaction_id, user_id)
        REFERENCES recurring_transactions (id, user_id) ON DELETE RESTRICT
);

ALTER TABLE transactions
    ADD CONSTRAINT transactions_recurring_occurrence_ownership
    FOREIGN KEY (recurring_occurrence_id, user_id)
    REFERENCES recurring_occurrences (id, user_id) ON DELETE RESTRICT;
