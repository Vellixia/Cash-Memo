CREATE FUNCTION reject_wallet_opening_balance_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.opening_balance IS DISTINCT FROM OLD.opening_balance THEN
        RAISE EXCEPTION 'wallet opening balance is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER wallets_opening_balance_immutable
    BEFORE UPDATE OF opening_balance ON wallets
    FOR EACH ROW EXECUTE FUNCTION reject_wallet_opening_balance_change();
