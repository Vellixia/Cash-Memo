import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCEPTED_PRE_0003_MIGRATION_FILES,
  ACCEPTED_PRE_0005_MIGRATION_FILES,
  applyMigrationFiles,
  applyMigrations,
  connectionUriForDatabase,
  migrationDirectory,
  readMigration,
  verifyMigrationChecksums,
} from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT_ONE = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_TWO = "00000000-0000-4000-8000-000000000002";
const CATEGORY_ONE = "10000000-0000-4000-8000-000000000001";
const LEGACY_CREDENTIAL = "50000000-0000-4000-8000-000000000001";
const LEGACY_SESSION = "60000000-0000-4000-8000-000000000001";
const LEGACY_VERIFICATION = "70000000-0000-4000-8000-000000000001";

const accountOwnedTables = [
  "account_deletions",
  "assisted_captures",
  "categories",
  "compose_drafts",
  "credential_accounts",
  "export_jobs",
  "history_list_states",
  "idempotency_records",
  "money_memos",
  "money_spaces",
  "preferences",
  "profiles",
  "provider_attempts",
  "provider_deletions",
  "reauth_grants",
  "sessions",
  "temporary_audio_metadata",
  "users",
] as const;

describe("reviewed PostgreSQL migrations", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
  }, 120_000);

  afterAll(async () => {
    await adminPool.end();
    await environment.stop();
  });

  it("matches reviewed checksums and contains only append-only safe-forward migrations", async () => {
    await expect(verifyMigrationChecksums()).resolves.toEqual({
      "0001_cashmemo_mvp.sql": "8819ffd33ff968a0c9a1a3b242a270e8258ccaf890e3fb76599b168decfc7291",
      "0002_roles_rls.sql": "dc0bf45d7b15a286ffbe24af740a0e79d9e4df60f8c0f2fe373f5e99d3999025",
      "0003_better_auth_compat.sql":
        "6f43200917f3f22b9ed6bc0b9e2c8ed69559b31e2ce74d314887a5b47e4ced12",
      "0004_identity_access_boundary.sql":
        "1ab96602ecd115c8f511174da01828da88341a7c6be5d15d77cefe0d9a51c2d0",
      "0005_search_projection.sql":
        "87a07250e0180a520f6667ca62b6e485dd5eeb883e1c27cd7722e6232051018b",
    });
    for (const filename of ACCEPTED_PRE_0003_MIGRATION_FILES) {
      const migration = await readMigration(filename);
      expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/iu);
    }
    const compatibilityMigration = await readMigration("0003_better_auth_compat.sql");
    expect(compatibilityMigration).not.toMatch(/\bDROP\s+TABLE\b/iu);
    expect(compatibilityMigration).toMatch(
      /DROP COLUMN "email_verified_at"[\s\S]*DROP COLUMN "password_changed_at"/u,
    );
    expect(compatibilityMigration).toMatch(
      /TRUNCATE TABLE "verification_tokens"[\s\S]*DROP TYPE "public"\."verification_purpose"/u,
    );
    const policy = await readFile(resolve(migrationDirectory, "README.md"), "utf8");
    expect(policy).toContain("Recovery is safe-forward");
    expect(policy).toContain("schema push is prohibited");
  });

  it("applies from a clean PostgreSQL 18 database with all 23 tables", async () => {
    await applyMigrations(adminPool);
    const version = await adminPool.query<{ server_version: string }>("SHOW server_version");
    expect(version.rows[0]?.server_version).toMatch(/^18\./u);

    const tables = await adminPool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(tables.rows).toHaveLength(23);
    expect(tables.rows.map((row) => row.table_name)).not.toContain("deletion_suppression_records");
  });

  it("installs the generated simple search projection, GIN index, and label refresh triggers", async () => {
    const columns = await adminPool.query<{
      column_name: string;
      data_type: string;
      is_generated: string;
    }>(
      `SELECT column_name, data_type, is_generated
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'money_memos'
         AND column_name IN ('search_document', 'search_vector')
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: "search_document", data_type: "text", is_generated: "NEVER" },
      { column_name: "search_vector", data_type: "tsvector", is_generated: "ALWAYS" },
    ]);
    const index = await adminPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'money_memos_search_vector_idx'`,
    );
    expect(index.rows[0]?.indexdef).toContain("USING gin (search_vector)");
    const triggers = await adminPool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
       WHERE NOT tgisinternal AND tgname IN (
         'money_memos_refresh_search_document',
         'categories_refresh_memo_search_documents',
         'money_spaces_refresh_memo_search_documents'
       ) ORDER BY tgname`,
    );
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      "categories_refresh_memo_search_documents",
      "money_memos_refresh_search_document",
      "money_spaces_refresh_memo_search_documents",
    ]);
  });

  it("safe-forward migrates an accepted pre-0005 database and backfills existing rows", async () => {
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    await adminPool.query("CREATE DATABASE cashmemo_pre_0005");
    const previousPool = new Pool({
      connectionString: connectionUriForDatabase(
        environment.postgres.connectionUri,
        "cashmemo_pre_0005",
      ),
    });
    try {
      await applyMigrationFiles(previousPool, ACCEPTED_PRE_0005_MIGRATION_FILES);
      await previousPool.query(
        `INSERT INTO users (id, name, email, email_verified, status)
         VALUES ($1, 'Cashmemo account', 'pre-0005@cashmemo.test', true, 'active')`,
        [ACCOUNT_ONE],
      );
      await previousPool.query(
        `INSERT INTO money_memos (
           id, user_id, direction, amount_minor, currency_code, currency_exponent,
           currency_registry_version, occurred_at, occurred_local, occurred_timezone,
           occurred_offset_minutes, timezone_database_version, note, origin, lifecycle_state, revision
         ) VALUES (gen_random_uuid(), $1, 'expense', 100, 'USD', 2, 'test-v1', now(),
           timestamp '2026-01-01 00:00:00', 'UTC', 0, 'test-tzdb', 'backfill token',
           'manual', 'active', 1)`,
        [ACCOUNT_ONE],
      );
      await applyMigrationFiles(previousPool, ["0005_search_projection.sql"]);
      const projection = await previousPool.query<{ matches: boolean }>(
        `SELECT search_vector @@ plainto_tsquery('simple', 'backfill') AS matches
         FROM money_memos WHERE user_id = $1`,
        [ACCOUNT_ONE],
      );
      expect(projection.rows[0]?.matches).toBe(true);
    } finally {
      await previousPool.end();
    }
  }, 30_000);

  it("forward-migrates representative accepted pre-0003 identity rows without fabricating tokens", async () => {
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    await adminPool.query("CREATE DATABASE cashmemo_previous_release");
    const previousPool = new Pool({
      connectionString: connectionUriForDatabase(
        environment.postgres.connectionUri,
        "cashmemo_previous_release",
      ),
    });
    try {
      await applyMigrationFiles(previousPool, ACCEPTED_PRE_0003_MIGRATION_FILES);
      await previousPool.query(
        `INSERT INTO users (id, email, email_verified_at, status)
         VALUES
           ($1, 'Legacy.Verified@Example.Test', timestamp '2026-01-02 03:04:05+00', 'active'),
           ($2, 'Legacy.Pending@Example.Test', NULL, 'pending_verification')`,
        [ACCOUNT_ONE, ACCOUNT_TWO],
      );
      await previousPool.query(
        `INSERT INTO credential_accounts
           (id, user_id, provider, password_hash, password_changed_at)
         VALUES ($1, $2, 'credential', '$argon2id$synthetic', timestamp '2026-01-02 03:04:05+00')`,
        [LEGACY_CREDENTIAL, ACCOUNT_ONE],
      );
      await previousPool.query(
        `INSERT INTO sessions (id, user_id, token, expires_at)
         VALUES ($1, $2, 'synthetic-session-not-evidence', now() + interval '1 day')`,
        [LEGACY_SESSION, ACCOUNT_ONE],
      );
      await previousPool.query(
        `INSERT INTO profiles (user_id, onboarding_state)
         VALUES ($1, 'in_progress')`,
        [ACCOUNT_ONE],
      );
      await previousPool.query(
        `INSERT INTO verification_tokens
           (id, purpose, subject_hmac, token_hash, expires_at)
         VALUES (
           $1, 'reset_password', decode(repeat('11', 32), 'hex'),
           decode(repeat('22', 32), 'hex'), now() + interval '1 hour'
         )`,
        [LEGACY_VERIFICATION],
      );

      await applyMigrationFiles(previousPool, ["0003_better_auth_compat.sql"]);

      const result = await previousPool.query<{ count: string }>(
        `SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(result.rows[0]?.count).toBe("23");

      const migratedUsers = await previousPool.query<{
        email: string;
        email_verified: boolean;
        id: string;
        name: string;
        status: string;
      }>(
        `SELECT id, name, email, email_verified, status
         FROM users ORDER BY id`,
      );
      expect(migratedUsers.rows).toEqual([
        {
          email: "legacy.verified@example.test",
          email_verified: true,
          id: ACCOUNT_ONE,
          name: "Cashmemo account",
          status: "active",
        },
        {
          email: "legacy.pending@example.test",
          email_verified: false,
          id: ACCOUNT_TWO,
          name: "Cashmemo account",
          status: "pending_verification",
        },
      ]);

      const migratedAccount = await previousPool.query<{
        access_token: string | null;
        account_id: string;
        password_hash: string | null;
      }>(
        `SELECT account_id, password_hash, access_token
         FROM credential_accounts WHERE id = $1`,
        [LEGACY_CREDENTIAL],
      );
      expect(migratedAccount.rows).toEqual([
        {
          access_token: null,
          account_id: ACCOUNT_ONE,
          password_hash: "$argon2id$synthetic",
        },
      ]);

      const surviving = await previousPool.query<{
        profiles: string;
        sessions: string;
        verifications: string;
      }>(
        `SELECT
           (SELECT count(*) FROM sessions)::text AS sessions,
           (SELECT count(*) FROM profiles)::text AS profiles,
           (SELECT count(*) FROM verification_tokens)::text AS verifications`,
      );
      expect(surviving.rows).toEqual([{ profiles: "1", sessions: "1", verifications: "0" }]);

      const identityColumns = await previousPool.query<{ column_name: string; table_name: string }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('users', 'credential_accounts', 'verification_tokens')`,
      );
      const names = new Set(
        identityColumns.rows.map((column) => `${column.table_name}.${column.column_name}`),
      );
      for (const obsoleteColumn of [
        "users.email_verified_at",
        "credential_accounts.password_changed_at",
        "verification_tokens.token_hash",
      ]) {
        expect(names.has(obsoleteColumn)).toBe(false);
      }
      expect([...names]).toEqual(
        expect.arrayContaining([
          "users.email_verified",
          "credential_accounts.account_id",
          "verification_tokens.identifier",
        ]),
      );
    } finally {
      await previousPool.end();
    }
  }, 30_000);

  it("enforces money, registry, lifecycle, and composite ownership constraints", async () => {
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status)
       VALUES
         ($1, 'Cashmemo account', 'migration-one@example.test', true, 'active'),
         ($2, 'Cashmemo account', 'migration-two@example.test', true, 'active')`,
      [ACCOUNT_ONE, ACCOUNT_TWO],
    );
    await adminPool.query(
      `INSERT INTO categories (id, user_id, kind, name, normalized_name)
       VALUES ($1, $2, 'expense', 'Food', 'food')`,
      [CATEGORY_ONE, ACCOUNT_ONE],
    );
    await adminPool.query(
      `INSERT INTO currency_registry_versions
         (version, source_cldr_version, reviewed_at, source_sha256, status)
       VALUES ('test-v1', 'test-cldr', now(), decode(repeat('00', 32), 'hex'), 'active')`,
    );
    await expect(
      adminPool.query(
        `INSERT INTO currency_registry_entries
           (registry_version, code, exponent, enabled, display_name_key)
         VALUES ('test-v1', 'USD', 4, true, 'currency.usd')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const invalidMemo = `INSERT INTO money_memos (
      id, user_id, direction, amount_minor, currency_code, currency_exponent,
      currency_registry_version, occurred_at, occurred_local, occurred_timezone,
      occurred_offset_minutes, timezone_database_version, category_id, origin
    ) VALUES (
      '20000000-0000-4000-8000-000000000001', $1, 'expense', $2, 'USD', 2,
      'test-v1', now(), timestamp '2026-01-01 12:00:00', 'UTC', 0, 'test-tzdb', $3, 'manual'
    )`;
    await expect(
      adminPool.query(invalidMemo, [ACCOUNT_ONE, 0, CATEGORY_ONE]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      adminPool.query(invalidMemo, [ACCOUNT_TWO, 100, CATEGORY_ONE]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("creates non-owner roles and forces RLS on every account-owned table", async () => {
    const roles = await adminPool.query<{
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolname: string;
      rolsuper: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
       FROM pg_roles
       WHERE rolname IN ('cashmemo_runtime', 'cashmemo_worker', 'cashmemo_migration', 'cashmemo_restore', 'cashmemo_identity')
       ORDER BY rolname`,
    );
    expect(roles.rows).toHaveLength(5);
    for (const role of roles.rows) {
      expect(role).toMatchObject({ rolbypassrls: false, rolcanlogin: false, rolsuper: false });
    }

    const rls = await adminPool.query<{
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])
       ORDER BY relname`,
      [[...accountOwnedTables]],
    );
    expect(rls.rows.map((row) => row.relname)).toEqual([...accountOwnedTables].sort());
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it("verifies identity role confinement after 0004", async () => {
    const identityPolicies = await adminPool.query<{ policyname: string; tablename: string }>(
      `SELECT policyname, tablename
       FROM pg_policies
       WHERE policyname LIKE '%identity%'
       ORDER BY tablename, policyname`,
    );
    const policyNames = identityPolicies.rows.map((r) => `${r.tablename}.${r.policyname}`);
    expect(policyNames).toEqual([
      "credential_accounts.credential_accounts_identity_access",
      "idempotency_records.idempotency_records_identity_signup",
      "sessions.sessions_identity_access",
      "users.users_identity_access",
      "verification_tokens.verification_tokens_identity_access",
    ]);

    const runtimeGrants = await adminPool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.role_table_grants
       WHERE grantee = 'cashmemo_runtime'
         AND table_name IN ('sessions', 'credential_accounts', 'verification_tokens')
         AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
    );
    expect(runtimeGrants.rows).toHaveLength(0);
  });
});
