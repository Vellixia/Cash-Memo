import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AwsDeletionSuppressionAdapter,
  ContractS3DeletionLedgerClient,
} from "../../src/adapters/aws/deletion-suppression.adapter.js";
import { AccountPurgeWorker } from "../../src/modules/deletion/account-purge.worker.js";
import { MemoPurgeWorker } from "../../src/modules/deletion/memo-purge.worker.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const MEMO_ACCOUNT = "00000000-0000-4000-8000-000000000187";
const ACCOUNT = "00000000-0000-4000-8000-000000000188";
const NEIGHBOR = "00000000-0000-4000-8000-000000000189";
const MEMO_ID = "10000000-0000-4000-8000-000000000187";
const DELETION_ID = "20000000-0000-4000-8000-000000000187";
const KEY = Buffer.from("synthetic-phase13-write-before-purge-key-v1", "utf8");
const AUDIT = Buffer.from("synthetic-phase13-write-before-purge-audit", "utf8");

describe("write-before-purge integration", { concurrent: false }, () => {
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
       ($1, 'Cashmemo account', 'phase13-memo@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'phase13-account@cashmemo.test', true, 'purging'),
       ($3, 'Cashmemo account', 'phase13-neighbor@cashmemo.test', true, 'active')`,
      [MEMO_ACCOUNT, ACCOUNT, NEIGHBOR],
    );
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  beforeEach(async () => {
    for (const table of [
      "provider_deletions",
      "account_deletions",
      "temporary_audio_metadata",
      "provider_attempts",
      "assisted_captures",
      "compose_drafts",
      "money_memos",
      "categories",
      "money_spaces",
      "preferences",
      "profiles",
      "history_list_states",
      "idempotency_records",
      "sessions",
    ]) {
      await admin.query(`DELETE FROM ${table}`);
    }
    await admin.query(
      `UPDATE users SET status = CASE WHEN id = $1 THEN 'purging'::user_status ELSE 'active'::user_status END,
       email = CASE WHEN id = $1 THEN 'phase13-account@cashmemo.test' WHEN id = $2 THEN 'phase13-memo@cashmemo.test' ELSE 'phase13-neighbor@cashmemo.test' END`,
      [ACCOUNT, MEMO_ACCOUNT],
    );
    await admin.query("INSERT INTO history_list_states (user_id) VALUES ($1), ($2), ($3)", [
      MEMO_ACCOUNT,
      ACCOUNT,
      NEIGHBOR,
    ]);
    await admin.query(
      `INSERT INTO money_memos (
        id, user_id, direction, amount_minor, currency_code, currency_exponent,
        currency_registry_version, occurred_at, occurred_local, occurred_timezone,
        occurred_offset_minutes, timezone_database_version, origin, lifecycle_state,
        prior_lifecycle_state, deleted_at, purge_after, updated_at, revision
      ) VALUES ($1, $2, 'expense', 1, 'USD', 2, 'synthetic-v1',
        '2026-08-01T00:00:00Z', '2026-08-01T00:00:00', 'UTC', 0, '2026a',
        'manual', 'purging', 'active', '2026-08-02T00:00:00Z', '2026-09-01T00:00:00Z', '2026-08-03T00:00:00Z', 2)`,
      [MEMO_ID, MEMO_ACCOUNT],
    );
    await admin.query(
      "INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale) VALUES ($1, 'USD', 'UTC', 'en-US')",
      [ACCOUNT],
    );
    await admin.query(
      "INSERT INTO sessions (id, user_id, token, expires_at) VALUES (gen_random_uuid(), $1, 'phase13-session', '2026-09-01T00:00:00Z')",
      [ACCOUNT],
    );
    await admin.query(
      `INSERT INTO account_deletions (id, user_id, state, requested_at, grace_ends_at, irreversible_at, live_purge_due_at, revision)
       VALUES ($1, $2, 'purging', '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z', '2026-08-08T00:00:00Z', '2026-08-09T00:00:00Z', 2)`,
      [DELETION_ID, ACCOUNT],
    );
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  function boundary() {
    const client = new ContractS3DeletionLedgerClient();
    const port = new AwsDeletionSuppressionAdapter({
      bucket: "synthetic",
      client,
      kmsKeyId: "synthetic-kms",
    });
    return { client, port };
  }

  function memoWorker(
    port: AwsDeletionSuppressionAdapter,
    afterSuppressionVerified?: () => Promise<void>,
  ) {
    return new MemoPurgeWorker({
      ...(afterSuppressionVerified === undefined ? {} : { afterSuppressionVerified }),
      auditHmacKey: AUDIT,
      policyVersion: "phase13-v1",
      pool: runtime,
      suppressionKey: KEY,
      suppressionKeyVersion: "key-v1",
      suppressionPort: port,
    });
  }

  function accountWorker(
    port: AwsDeletionSuppressionAdapter,
    afterSuppressionVerified?: () => Promise<void>,
  ) {
    return new AccountPurgeWorker({
      ...(afterSuppressionVerified === undefined ? {} : { afterSuppressionVerified }),
      auditHmacKey: AUDIT,
      deleteExports: vi.fn(() => Promise.resolve()),
      identityPool: admin,
      policyVersion: "phase13-v1",
      pool: runtime,
      suppressionKey: KEY,
      suppressionKeyVersion: "key-v1",
      suppressionPort: port,
    });
  }

  it("permits memo hard deletion only after verified durable ledger write", async () => {
    const { port } = boundary();
    await expect(memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID)).resolves.toMatchObject({
      hardDeleted: true,
      suppressionDurable: true,
    });
  });

  it("keeps memo inaccessible and present when ledger write fails", async () => {
    const { client, port } = boundary();
    client.setFaultForTest("write_failure");
    await expect(memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID)).resolves.toMatchObject({
      hardDeleted: false,
      state: "suppression_pending",
    });
    expect(
      (await admin.query("SELECT lifecycle_state FROM money_memos WHERE id=$1", [MEMO_ID])).rows[0],
    ).toEqual({ lifecycle_state: "purging" });
  });

  it("hard-deletes zero account content on ambiguous ledger verification", async () => {
    const { client, port } = boundary();
    client.setFaultForTest("ambiguous");
    await expect(accountWorker(port).purge(ACCOUNT, DELETION_ID)).resolves.toMatchObject({
      hardDeletedContent: false,
      state: "suppression_pending",
    });
    expect(
      (await admin.query("SELECT count(*)::int count FROM preferences WHERE user_id=$1", [ACCOUNT]))
        .rows[0],
    ).toEqual({ count: 1 });
  });

  it("resumes safely after crash following ledger durability but before memo deletion", async () => {
    const { port } = boundary();
    await expect(
      memoWorker(port, () => Promise.reject(new Error("SYNTHETIC_CRASH"))).purge(
        MEMO_ACCOUNT,
        MEMO_ID,
      ),
    ).rejects.toThrow("SYNTHETIC_CRASH");
    expect(
      (await admin.query("SELECT count(*)::int count FROM money_memos WHERE id=$1", [MEMO_ID]))
        .rows[0],
    ).toEqual({ count: 1 });
    await expect(memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID)).resolves.toMatchObject({
      hardDeleted: true,
    });
  });

  it("keeps content when worker crashes before durable ledger write", async () => {
    const { client, port } = boundary();
    client.setFaultForTest("write_failure");
    await memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID);
    expect(
      (await admin.query("SELECT count(*)::int count FROM money_memos WHERE id=$1", [MEMO_ID]))
        .rows[0],
    ).toEqual({ count: 1 });
  });

  it("makes duplicate memo delivery idempotent", async () => {
    const { port } = boundary();
    await memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID);
    await expect(memoWorker(port).purge(MEMO_ACCOUNT, MEMO_ID)).resolves.toMatchObject({
      hardDeleted: false,
      state: "already_absent",
    });
  });

  it("makes account purge retry and duplicate delivery idempotent", async () => {
    const { port } = boundary();
    await expect(
      accountWorker(port, () => Promise.reject(new Error("SYNTHETIC_CRASH"))).purge(
        ACCOUNT,
        DELETION_ID,
      ),
    ).rejects.toThrow("SYNTHETIC_CRASH");
    await expect(accountWorker(port).purge(ACCOUNT, DELETION_ID)).resolves.toMatchObject({
      hardDeletedContent: true,
      state: "live_purged",
    });
    await expect(accountWorker(port).purge(ACCOUNT, DELETION_ID)).resolves.toMatchObject({
      hardDeletedContent: false,
      state: "already_purged",
    });
  });
});
