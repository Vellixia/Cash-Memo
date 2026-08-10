DO $identity_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashmemo_identity') THEN
    CREATE ROLE cashmemo_identity NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$identity_role$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO cashmemo_identity;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO cashmemo_identity;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE credential_accounts TO cashmemo_identity;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO cashmemo_identity;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE verification_tokens TO cashmemo_identity;--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE idempotency_records TO cashmemo_identity;--> statement-breakpoint

DO $identity_policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'users_identity_access' AND tablename = 'users'
  ) THEN
    CREATE POLICY users_identity_access ON users
      FOR ALL TO cashmemo_identity
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'credential_accounts_identity_access' AND tablename = 'credential_accounts'
  ) THEN
    CREATE POLICY credential_accounts_identity_access ON credential_accounts
      FOR ALL TO cashmemo_identity
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'sessions_identity_access' AND tablename = 'sessions'
  ) THEN
    CREATE POLICY sessions_identity_access ON sessions
      FOR ALL TO cashmemo_identity
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'verification_tokens_identity_access' AND tablename = 'verification_tokens'
  ) THEN
    CREATE POLICY verification_tokens_identity_access ON verification_tokens
      FOR ALL TO cashmemo_identity
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'idempotency_records_identity_signup' AND tablename = 'idempotency_records'
  ) THEN
    CREATE POLICY idempotency_records_identity_signup ON idempotency_records
      FOR ALL TO cashmemo_identity
      USING (operation = 'signup_side_effect')
      WITH CHECK (operation = 'signup_side_effect');
  END IF;
END
$identity_policies$;--> statement-breakpoint

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE sessions FROM cashmemo_runtime;--> statement-breakpoint
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE credential_accounts FROM cashmemo_runtime;--> statement-breakpoint
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE verification_tokens FROM cashmemo_runtime;--> statement-breakpoint

DO $identity_confinement$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashmemo_identity') THEN
    REVOKE cashmemo_migration FROM cashmemo_identity;
    REVOKE cashmemo_worker FROM cashmemo_identity;
    REVOKE cashmemo_restore FROM cashmemo_identity;
    REVOKE cashmemo_runtime FROM cashmemo_identity;
  END IF;
END
$identity_confinement$;--> statement-breakpoint

REVOKE ALL ON TABLE profiles, preferences, categories, money_spaces, money_memos,
  compose_drafts, assisted_captures, provider_attempts, temporary_audio_metadata,
  export_jobs, account_deletions, provider_deletions,
  history_list_states, background_jobs, content_free_mutation_audits,
  currency_registry_versions, currency_registry_entries, reauth_grants
FROM cashmemo_identity;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES FOR ROLE cashmemo_migration IN SCHEMA public
  REVOKE ALL ON TABLES FROM cashmemo_identity;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE cashmemo_migration IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM cashmemo_identity;
