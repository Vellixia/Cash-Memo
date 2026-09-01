CREATE OR REPLACE FUNCTION reject_recurring_occurrence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Occurrences are immutable until their owning user is deleted. PostgreSQL
    -- runs the user FK cascade from an internal trigger after the parent row is
    -- gone; ordinary application UPDATE/DELETE statements run at depth one.
    IF TG_OP = 'DELETE'
       AND pg_trigger_depth() > 1
       AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
    THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'recurring occurrences are immutable';
END;
$$;
