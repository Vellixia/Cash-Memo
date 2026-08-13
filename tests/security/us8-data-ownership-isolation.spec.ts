import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ContractExportObjectStore } from "../../apps/server/src/adapters/rustfs/export-object-store.adapter.js";
import { withAccountTransaction } from "../../apps/server/src/adapters/postgres/transaction-context.js";
import { AccountDeletionService } from "../../apps/server/src/modules/deletion/account-deletion.service.js";
import { ContractDeletionSuppressionPort } from "../../apps/server/src/modules/deletion/deletion-suppression.port.js";
import { MemoPurgeWorker } from "../../apps/server/src/modules/deletion/memo-purge.worker.js";
import { ExportJobService } from "../../apps/server/src/modules/export/export-job.service.js";
import { BackgroundJobRepository } from "../../apps/server/src/modules/operations/background-jobs.js";
import { applyMigrations } from "../../apps/server/tests/integration/support/postgres-migrations.js";
import {
  startTestEnvironment,
  type TestEnvironment,
} from "../../apps/server/tests/integration/support/test-environment.js";

const OWNER = "00000000-0000-4000-8000-000000000180";
const OTHER = "00000000-0000-4000-8000-000000000181";
const MEMO = "10000000-0000-4000-8000-000000000180";
const WORKER = "20000000-0000-4000-8000-000000000180";
const KEY = Buffer.from("synthetic-us8-isolation-key-material-v1", "utf8");
const NOW = new Date("2026-08-11T00:00:00.000Z");

describe("US8 data ownership and irreversibility matrix", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;
  let worker: Pool;
  let exports: ExportJobService;
  let deletions: AccountDeletionService;
  let purge: MemoPurgeWorker;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("POSTGRES_MISSING");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'us8-owner@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'us8-other@cashmemo.test', true, 'active')`,
      [OWNER, OTHER],
    );
    for (const accountId of [OWNER, OTHER]) {
      await admin.query(
        `INSERT INTO profiles
           (user_id, onboarding_state, privacy_notice_version, privacy_notice_accepted_at)
         VALUES ($1, 'complete', 'privacy-v1', $2)`,
        [accountId, NOW],
      );
      await admin.query(
        `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
         VALUES ($1, 'USD', 'UTC', 'en-US')`,
        [accountId],
      );
    }
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
    worker = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_worker",
    });
  }, 120_000);

  beforeEach(async () => {
    await admin.query("DELETE FROM content_free_mutation_audits");
    await admin.query("DELETE FROM background_jobs");
    await admin.query("DELETE FROM provider_deletions");
    await admin.query("DELETE FROM account_deletions");
    await admin.query("DELETE FROM export_jobs");
    await admin.query("DELETE FROM idempotency_records");
    await admin.query("DELETE FROM money_memos");
    await admin.query("UPDATE users SET status = 'active'");
    await admin.query(
      `INSERT INTO money_memos (
         id, user_id, direction, amount_minor, currency_code, currency_exponent,
         currency_registry_version, occurred_at, occurred_local, occurred_timezone,
         occurred_offset_minutes, timezone_database_version, note, origin,
         lifecycle_state, prior_lifecycle_state, deleted_at, purge_after, revision
       ) VALUES ($1, $2, 'expense', 1, 'USD', 2, 'registry-v1', $3, '2026-08-11T00:00:00',
                 'UTC', 0, '2026a', NULL, 'manual', 'recently_deleted', 'active', $3,
                 $3::timestamptz + interval '30 days', 1)`,
      [MEMO, OWNER, NOW],
    );
    exports = new ExportJobService({
      backgroundJobs: new BackgroundJobRepository(worker, {
        backoffBaseMilliseconds: 10,
        backoffMaximumMilliseconds: 100,
        leaseMilliseconds: 1_000,
      }),
      hmacKey: KEY,
      now: () => NOW,
      objectReferenceKey: KEY,
      objectStore: new ContractExportObjectStore(),
      pool: runtime,
    });
    deletions = new AccountDeletionService({ hmacKey: KEY, now: () => NOW, pool: runtime });
    purge = new MemoPurgeWorker({
      auditHmacKey: KEY,
      policyVersion: "phase12-v1",
      pool: runtime,
      suppressionKey: KEY,
      suppressionKeyVersion: "v1",
      suppressionPort: new ContractDeletionSuppressionPort(),
    });
  });

  afterAll(async () => {
    await worker.end();
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  it("keeps export status, download, cancel, and opaque object identity owner-only", async () => {
    const queued = await exports.request(OWNER, {
      idempotencyKey: crypto.randomUUID(),
      includeRecoverableDrafts: false,
      schemaVersion: "1.0",
    });
    const ready = await exports.process(OWNER, queued.id, false, WORKER);
    await expect(exports.get(OTHER, ready.id)).rejects.toMatchObject({ code: "EXPORT_NOT_FOUND" });
    await expect(exports.download(OTHER, ready.id)).rejects.toMatchObject({
      code: "EXPORT_NOT_FOUND",
    });
    await expect(exports.cancel(OTHER, ready.id, ready.revision)).rejects.toMatchObject({
      code: "EXPORT_NOT_FOUND",
    });
    expect(JSON.stringify(ready)).not.toMatch(/s3|bucket|object[_-]?key|url/iu);
  });

  it("RLS blocks forged memo IDs and purge target remains account-scoped", async () => {
    const visibleToOther = await withAccountTransaction(runtime, OTHER, (transaction) =>
      transaction.query("SELECT id FROM money_memos WHERE id = $1", [MEMO]),
    );
    expect(visibleToOther.rowCount).toBe(0);
    await expect(purge.purge(OTHER, MEMO)).resolves.toMatchObject({ state: "already_absent" });
    expect(
      (await admin.query("SELECT count(*)::int AS count FROM money_memos WHERE id = $1", [MEMO]))
        .rows[0],
    ).toEqual({ count: 1 });
  });

  it("keeps account deletion status/cancel isolated across accounts", async () => {
    const requested = await deletions.request(OWNER, crypto.randomUUID());
    await expect(deletions.status(OTHER)).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_NOT_FOUND",
    });
    await expect(deletions.cancel(OTHER, requested.revision)).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_NOT_FOUND",
    });
    await expect(deletions.journalAccessState(OTHER)).resolves.toBe("active");
  });

  it("cannot bypass irreversible state with stale owner authorization", async () => {
    const requested = await deletions.request(OWNER, crypto.randomUUID());
    const purging = await deletions.beginIrreversible(OWNER, new Date(requested.graceEndsAt));
    await expect(deletions.cancel(OWNER, purging.revision)).rejects.toMatchObject({
      code: "IRREVERSIBLE_DELETION",
    });
  });

  it("never exposes suppression tokens as user-facing identifiers", async () => {
    const controller =
      await import("../../apps/server/src/modules/deletion/account-deletion.controller.js");
    expect(Object.keys(controller).join(" ")).not.toMatch(/suppression|deletionToken/iu);
  });
});
