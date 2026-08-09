import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyMigrations,
  connectionUriForDatabase,
  MIGRATION_FILES,
  migrationDirectory,
  readMigration,
  verifyMigrationChecksums,
} from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT_ONE = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_TWO = "00000000-0000-4000-8000-000000000002";
const CATEGORY_ONE = "10000000-0000-4000-8000-000000000001";

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
    });
    for (const filename of MIGRATION_FILES) {
      const migration = await readMigration(filename);
      expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/iu);
    }
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

  it("applies forward from the declared empty previous-release baseline", async () => {
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    await adminPool.query("CREATE DATABASE cashmemo_previous_release");
    const previousPool = new Pool({
      connectionString: connectionUriForDatabase(
        environment.postgres.connectionUri,
        "cashmemo_previous_release",
      ),
    });
    try {
      await applyMigrations(previousPool);
      const result = await previousPool.query<{ count: string }>(
        `SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(result.rows[0]?.count).toBe("23");
    } finally {
      await previousPool.end();
    }
  });

  it("enforces money, registry, lifecycle, and composite ownership constraints", async () => {
    await adminPool.query(
      `INSERT INTO users (id, email, email_verified_at, status)
       VALUES
         ($1, 'migration-one@example.test', now(), 'active'),
         ($2, 'migration-two@example.test', now(), 'active')`,
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
       WHERE rolname IN ('cashmemo_runtime', 'cashmemo_worker', 'cashmemo_migration', 'cashmemo_restore')
       ORDER BY rolname`,
    );
    expect(roles.rows).toHaveLength(4);
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
});
