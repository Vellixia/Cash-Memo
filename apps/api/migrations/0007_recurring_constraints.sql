CREATE INDEX IF NOT EXISTS recurring_transactions_due_active_idx ON recurring_transactions (next_due_date, id) WHERE status = 'active';
CREATE OR REPLACE FUNCTION reject_recurring_occurrence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recurring occurrences are immutable'; END; $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'recurring_occurrences_immutable' AND tgrelid = 'recurring_occurrences'::regclass) THEN
        CREATE TRIGGER recurring_occurrences_immutable BEFORE UPDATE OR DELETE ON recurring_occurrences FOR EACH ROW EXECUTE FUNCTION reject_recurring_occurrence_mutation();
    END IF;
END; $$;
