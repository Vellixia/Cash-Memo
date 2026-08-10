-- Create a dedicated login role for the identity pool.
-- This role can only become cashmemo_identity, not cashmemo_runtime or other privileged roles.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cashmemo_identity_login') THEN
    CREATE ROLE cashmemo_identity_login LOGIN PASSWORD 'cashmemo-identity-local-only' IN ROLE cashmemo_identity;
  END IF;
END
$$;