ALTER TABLE users
    ADD COLUMN timezone_configured_at TIMESTAMPTZ;

DROP INDEX categories_starter_key_unique;

ALTER TABLE categories
    ADD CONSTRAINT categories_user_starter_key_unique UNIQUE (user_id, starter_key);

CREATE FUNCTION reject_category_starter_key_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.starter_key IS DISTINCT FROM OLD.starter_key THEN
        RAISE EXCEPTION 'category starter key is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER categories_starter_key_immutable
    BEFORE UPDATE OF starter_key ON categories
    FOR EACH ROW EXECUTE FUNCTION reject_category_starter_key_change();
