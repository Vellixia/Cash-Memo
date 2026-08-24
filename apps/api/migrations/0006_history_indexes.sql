CREATE INDEX transactions_active_history_order_idx
    ON transactions (user_id, occurred_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX transactions_trash_purge_idx
    ON transactions (user_id, purge_after)
    WHERE deleted_at IS NOT NULL;
