DROP TRIGGER wallets_opening_balance_immutable ON wallets;
DROP FUNCTION reject_wallet_opening_balance_change();

ALTER TABLE users
    ADD COLUMN onboarding_completed_at TIMESTAMPTZ;

UPDATE users u
SET onboarding_completed_at = now()
WHERE u.timezone_configured_at IS NOT NULL
  AND u.default_currency_code IS NOT NULL
  AND EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id);
