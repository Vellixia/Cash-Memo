DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashmemo_runtime') THEN
    CREATE ROLE cashmemo_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashmemo_worker') THEN
    CREATE ROLE cashmemo_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashmemo_migration') THEN
    CREATE ROLE cashmemo_migration NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashmemo_restore') THEN
    CREATE ROLE cashmemo_restore NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$roles$;--> statement-breakpoint

REVOKE ALL ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO cashmemo_runtime, cashmemo_worker;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.cashmemo_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cashmemo_current_user_id() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cashmemo_current_user_id() TO cashmemo_runtime;--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users,
  credential_accounts,
  verification_tokens,
  sessions,
  reauth_grants,
  profiles,
  preferences,
  categories,
  money_spaces,
  money_memos,
  compose_drafts,
  assisted_captures,
  provider_attempts,
  temporary_audio_metadata,
  idempotency_records,
  export_jobs,
  account_deletions,
  provider_deletions,
  history_list_states
TO cashmemo_runtime;--> statement-breakpoint
GRANT SELECT ON TABLE currency_registry_versions, currency_registry_entries TO cashmemo_runtime;--> statement-breakpoint
GRANT INSERT ON TABLE content_free_mutation_audits TO cashmemo_runtime;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE background_jobs TO cashmemo_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE content_free_mutation_audits TO cashmemo_worker;--> statement-breakpoint
GRANT SELECT ON TABLE currency_registry_versions, currency_registry_entries TO cashmemo_worker;--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY users_account_isolation ON users
  FOR ALL TO cashmemo_runtime
  USING (id = public.cashmemo_current_user_id())
  WITH CHECK (id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE credential_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credential_accounts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY credential_accounts_account_isolation ON credential_accounts
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sessions_account_isolation ON sessions
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE reauth_grants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE reauth_grants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY reauth_grants_account_isolation ON reauth_grants
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY profiles_account_isolation ON profiles
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE preferences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE preferences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY preferences_account_isolation ON preferences
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE categories FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY categories_account_isolation ON categories
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE money_spaces ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE money_spaces FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY money_spaces_account_isolation ON money_spaces
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE money_memos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE money_memos FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY money_memos_account_isolation ON money_memos
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE compose_drafts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE compose_drafts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY compose_drafts_account_isolation ON compose_drafts
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE assisted_captures ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE assisted_captures FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY assisted_captures_account_isolation ON assisted_captures
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE provider_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE provider_attempts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY provider_attempts_account_isolation ON provider_attempts
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE temporary_audio_metadata ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE temporary_audio_metadata FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY temporary_audio_metadata_account_isolation ON temporary_audio_metadata
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY idempotency_records_account_isolation ON idempotency_records
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY export_jobs_account_isolation ON export_jobs
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE account_deletions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY account_deletions_account_isolation ON account_deletions
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE provider_deletions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE provider_deletions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY provider_deletions_account_isolation ON provider_deletions
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER TABLE history_list_states ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE history_list_states FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY history_list_states_account_isolation ON history_list_states
  FOR ALL TO cashmemo_runtime
  USING (user_id = public.cashmemo_current_user_id())
  WITH CHECK (user_id = public.cashmemo_current_user_id());--> statement-breakpoint

ALTER DEFAULT PRIVILEGES FOR ROLE cashmemo_migration IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE cashmemo_migration IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;--> statement-breakpoint
