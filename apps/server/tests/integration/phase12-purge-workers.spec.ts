import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPurgeWorker } from "../../src/modules/deletion/account-purge.worker.js";
import { ContractDeletionSuppressionPort } from "../../src/modules/deletion/deletion-suppression.port.js";
import { MemoPurgeWorker } from "../../src/modules/deletion/memo-purge.worker.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const MEMO_ACCOUNT = "00000000-0000-4000-8000-000000000177";
const ACCOUNT = "00000000-0000-4000-8000-000000000178";
const OTHER = "00000000-0000-4000-8000-000000000179";
const MEMO_ID = "10000000-0000-4000-8000-000000000177";
const DELETION_ID = "20000000-0000-4000-8000-000000000178";
const KEY = Buffer.from("synthetic-phase12-suppression-key-material-v1", "utf8");
const AUDIT = Buffer.from("synthetic-phase12-audit-hmac-key-material-v1", "utf8");

describe("Phase 12 suppression-gated purge workers", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL missing");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'memo-purge@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'account-purge@cashmemo.test', true, 'purging'),
       ($3, 'Cashmemo account', 'purge-neighbor@cashmemo.test', true, 'active')`,
      [MEMO_ACCOUNT, ACCOUNT, OTHER],
    );
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  beforeEach(async () => {
    await admin.query("DELETE FROM provider_deletions");
    await admin.query("DELETE FROM account_deletions");
    await admin.query("DELETE FROM temporary_audio_metadata");
    await admin.query("DELETE FROM provider_attempts");
    await admin.query("DELETE FROM assisted_captures");
    await admin.query("DELETE FROM compose_drafts");
    await admin.query("DELETE FROM money_memos");
    await admin.query("DELETE FROM categories");
    await admin.query("DELETE FROM money_spaces");
    await admin.query("DELETE FROM preferences");
    await admin.query("DELETE FROM profiles");
    await admin.query("DELETE FROM history_list_states");
    await admin.query("DELETE FROM idempotency_records");
    await admin.query("DELETE FROM sessions");
    await admin.query(
      `UPDATE users SET status = CASE WHEN id = $1 THEN 'purging'::user_status ELSE 'active'::user_status END,
                        email = CASE WHEN id = $1 THEN 'account-purge@cashmemo.test'
                                     WHEN id = $2 THEN 'memo-purge@cashmemo.test'
                                     ELSE 'purge-neighbor@cashmemo.test' END`,
      [ACCOUNT, MEMO_ACCOUNT],
    );
    await admin.query(`INSERT INTO history_list_states (user_id) VALUES ($1), ($2), ($3)`, [
      MEMO_ACCOUNT,
      ACCOUNT,
      OTHER,
    ]);
    await admin.query(
      `INSERT INTO money_memos (
         id, user_id, direction, amount_minor, currency_code, currency_exponent,
         currency_registry_version, occurred_at, occurred_local, occurred_timezone,
         occurred_offset_minutes, timezone_database_version, origin, lifecycle_state,
         prior_lifecycle_state, deleted_at, purge_after, updated_at, revision
       ) VALUES ($1, $2, 'expense', 1250, 'USD', 2, 'synthetic-v1',
         '2026-08-01T00:00:00Z', '2026-08-01T00:00:00', 'UTC', 0, '2026a',
         'manual', 'purging', 'active', '2026-08-02T00:00:00Z',
         '2026-09-01T00:00:00Z', '2026-08-03T00:00:00Z', 2)`,
      [MEMO_ID, MEMO_ACCOUNT],
    );
    await admin.query(`INSERT INTO profiles (user_id, onboarding_state) VALUES ($1, 'complete')`, [
      ACCOUNT,
    ]);
    await admin.query(
      `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
       VALUES ($1, 'USD', 'UTC', 'en-US')`,
      [ACCOUNT],
    );
    await admin.query(
      `INSERT INTO sessions (id, user_id, token, expires_at)
       VALUES (gen_random_uuid(), $1, 'account-purge-session', '2026-09-01T00:00:00Z')`,
      [ACCOUNT],
    );
    await admin.query(
      `INSERT INTO account_deletions (
         id, user_id, state, requested_at, grace_ends_at, irreversible_at,
         live_purge_due_at, revision
       ) VALUES ($1, $2, 'purging', '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z',
                 '2026-08-08T00:00:00Z', '2026-08-09T00:00:00Z', 2)`,
      [DELETION_ID, ACCOUNT],
    );
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  function memoWorker(port: ContractDeletionSuppressionPort) {
    return new MemoPurgeWorker({
      auditHmacKey: AUDIT,
      policyVersion: "phase12-policy-v1",
      pool: runtime,
      suppressionKey: KEY,
      suppressionKeyVersion: "key-v1",
      suppressionPort: port,
    });
  }

  it("does not hard-delete memo when suppression durable write fails", async () => {
    const port = new ContractDeletionSuppressionPort();
    port.setWriteFailureForTest(true);
    await expect(memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID)).resolves.toEqual({
      hardDeleted: false,
      state: "suppression_pending",
      suppressionDurable: false,
    });
    expect(
      (await admin.query("SELECT lifecycle_state FROM money_memos WHERE id = $1", [MEMO_ID]))
        .rows[0],
    ).toEqual({ lifecycle_state: "purging" });
  });

  it("writes and verifies memo suppression before idempotent hard deletion", async () => {
    const port = new ContractDeletionSuppressionPort();
    await expect(memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID)).resolves.toMatchObject({
      hardDeleted: true,
      state: "purged",
      suppressionDurable: true,
    });
    expect(port.countForTest()).toBe(1);
    expect(
      (await admin.query("SELECT count(*)::int AS count FROM money_memos WHERE id = $1", [MEMO_ID]))
        .rows[0],
    ).toEqual({ count: 0 });
    await expect(memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID)).resolves.toMatchObject({
      state: "already_absent",
    });
  });

  it("does not delete any account content when account suppression write fails", async () => {
    const port = new ContractDeletionSuppressionPort();
    port.setWriteFailureForTest(true);
    const deleteExports = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const worker = new AccountPurgeWorker({
      auditHmacKey: AUDIT,
      deleteExports,
      identityPool: admin,
      policyVersion: "phase12-policy-v1",
      pool: runtime,
      suppressionKey: KEY,
      suppressionKeyVersion: "key-v1",
      suppressionPort: port,
    });
    await expect(worker.purge(ACCOUNT, DELETION_ID)).resolves.toEqual({
      hardDeletedContent: false,
      state: "suppression_pending",
      suppressionDurable: false,
    });
    expect(deleteExports).not.toHaveBeenCalled();
    expect(
      (
        await admin.query("SELECT count(*)::int AS count FROM preferences WHERE user_id = $1", [
          ACCOUNT,
        ])
      ).rows[0],
    ).toEqual({ count: 1 });
    expect(
      (await admin.query("SELECT state FROM account_deletions WHERE id = $1", [DELETION_ID]))
        .rows[0],
    ).toEqual({ state: "purging" });
  });

  it("purges account live content only after suppression and preserves pending provider semantics", async () => {
    const port = new ContractDeletionSuppressionPort();
    const deleteExports = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const worker = new AccountPurgeWorker({
      auditHmacKey: AUDIT,
      deleteExports,
      identityPool: admin,
      policyVersion: "phase12-policy-v1",
      pool: runtime,
      suppressionKey: KEY,
      suppressionKeyVersion: "key-v1",
      suppressionPort: port,
    });
    await expect(worker.purge(ACCOUNT, DELETION_ID)).resolves.toEqual({
      hardDeletedContent: true,
      state: "live_purged",
      suppressionDurable: true,
    });
    expect(deleteExports).toHaveBeenCalledWith(ACCOUNT);
    expect(port.countForTest()).toBe(1);
    expect(
      (
        await admin.query("SELECT count(*)::int AS count FROM preferences WHERE user_id = $1", [
          ACCOUNT,
        ])
      ).rows[0],
    ).toEqual({ count: 0 });
    expect(
      (
        await admin.query("SELECT count(*)::int AS count FROM sessions WHERE user_id = $1", [
          ACCOUNT,
        ])
      ).rows[0],
    ).toEqual({ count: 0 });
    expect(
      (await admin.query("SELECT status, email FROM users WHERE id = $1", [ACCOUNT])).rows[0],
    ).toMatchObject({ status: "purged" });
    expect(
      (await admin.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [ACCOUNT]))
        .rows[0]?.email,
    ).not.toContain("account-purge@cashmemo.test");
    expect(
      (await admin.query("SELECT state FROM account_deletions WHERE id = $1", [DELETION_ID]))
        .rows[0],
    ).toEqual({ state: "live_purged" });
    expect((await admin.query("SELECT status FROM users WHERE id = $1", [OTHER])).rows[0]).toEqual({
      status: "active",
    });
  });
});
