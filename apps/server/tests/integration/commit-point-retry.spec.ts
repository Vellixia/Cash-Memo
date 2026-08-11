import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { canonicalRequestHmac } from "@cashmemo/domain";
import { FinitePrivacyBoundary } from "@cashmemo/privacy-rules";
import { DeterministicFaultProxy } from "@cashmemo/test-support";

import { withAccountTransaction } from "../../src/adapters/postgres/transaction-context.js";
import { ConfirmDraftService } from "../../src/modules/assisted-capture/confirm-draft.service.js";
import { createDraft } from "../../src/modules/draft/draft.service.js";
import { createMoneyMemo, type MoneyMemoInput } from "../../src/modules/memo/money-memo.service.js";
import { BackgroundJobRepository } from "../../src/modules/operations/background-jobs.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000155";
const WORKER_A = "10000000-0000-4000-8000-000000000155";
const WORKER_B = "20000000-0000-4000-8000-000000000155";
const HMAC = Buffer.from("synthetic-commit-point-hmac-key-32-bytes");
const memo: MoneyMemoInput = {
  categoryId: null,
  direction: "expense",
  money: { amount: "12.50", currency: "USD" },
  moneySpaceId: null,
  note: null,
  occurrence: {
    occurredAt: "2026-08-11T10:00:00Z",
    occurredLocal: "2026-08-11T10:00:00",
    occurredOffsetMinutes: 0,
    occurredTimezone: "UTC",
    timezoneDatabaseVersion: "2025b",
  },
  planningStatus: "unplanned",
  purpose: "personal",
};

describe("commit-point retry against real PostgreSQL", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL missing");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status)
       VALUES ($1, 'Cashmemo account', 'commit-point@cashmemo.test', true, 'active')`,
      [ACCOUNT],
    );
    await admin.query(`INSERT INTO history_list_states (user_id) VALUES ($1)`, [ACCOUNT]);
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  beforeEach(async () => {
    await admin.query("DELETE FROM background_jobs");
    await admin.query("DELETE FROM idempotency_records");
    await admin.query("DELETE FROM assisted_captures");
    await admin.query("DELETE FROM compose_drafts");
    await admin.query("DELETE FROM money_memos");
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  function requestHmac(operation: string, payload: unknown): Buffer {
    return Buffer.from(
      canonicalRequestHmac({ hmacKey: HMAC, operation, payload, schemaVersion: "fault-v1" }),
      "hex",
    );
  }

  async function createManual(key: string) {
    return withAccountTransaction(runtime, ACCOUNT, async (transaction) =>
      createMoneyMemo(transaction, memo, key, requestHmac("memo_create", memo)),
    );
  }

  it("rolls back all authority when failure occurs before commit, then retry creates one", async () => {
    const key = crypto.randomUUID();
    await expect(
      withAccountTransaction(runtime, ACCOUNT, async (transaction) => {
        await createMoneyMemo(transaction, memo, key, requestHmac("memo_create", memo));
        throw new Error("CONTROLLED_FAILURE_BEFORE_COMMIT");
      }),
    ).rejects.toThrow("CONTROLLED_FAILURE_BEFORE_COMMIT");
    expect((await admin.query("SELECT count(*)::int AS count FROM money_memos")).rows[0]).toEqual({
      count: 0,
    });
    await createManual(key);
    expect((await admin.query("SELECT count(*)::int AS count FROM money_memos")).rows[0]).toEqual({
      count: 1,
    });
  });

  it("reconciles committed response loss to same manual memo", async () => {
    const key = crypto.randomUUID();
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: async () => createManual(key),
        identity: key,
        operation: "memo.confirm",
        scenario: "lost_response",
      }),
    ).rejects.toMatchObject({ commitState: "committed" });
    const retry = await createManual(key);
    const rows = await admin.query<{ id: string }>("SELECT id FROM money_memos");
    expect(rows.rows).toHaveLength(1);
    expect(retry.id).toBe(rows.rows[0]?.id);
  });

  it("reconciles committed response loss to same assisted confirmation", async () => {
    const draft = await createDraft(runtime, ACCOUNT, {
      candidateFields: { amount: "12.50", currency: "USD", direction: "expense" },
      captureStartedAt: "2026-08-11T09:00:00Z",
      captureTimezone: "UTC",
      origin: "natural_language",
      sourceCompleteness: "complete",
      sourceText: "synthetic source",
      status: "reviewable",
    });
    const service = new ConfirmDraftService({
      hmacKey: HMAC,
      pool: runtime,
      privacy: new FinitePrivacyBoundary(),
    });
    const key = crypto.randomUUID();
    const input = {
      confirmation: "CONFIRM_MONEY_MEMO" as const,
      expectedRevision: draft.revision,
      memo,
    };
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: async () => service.confirm(ACCOUNT, draft.id, key, input),
        identity: key,
        operation: "draft.confirm",
        scenario: "lost_response",
      }),
    ).rejects.toMatchObject({ commitState: "committed" });
    const retry = await service.confirm(ACCOUNT, draft.id, key, input);
    const rows = await admin.query<{ id: string }>("SELECT id FROM money_memos");
    expect(rows.rows).toHaveLength(1);
    expect(retry.id).toBe(rows.rows[0]?.id);
  });

  it("deduplicates repeated background job delivery", async () => {
    const jobs = new BackgroundJobRepository(admin, {
      backoffBaseMilliseconds: 10,
      backoffMaximumMilliseconds: 100,
      leaseMilliseconds: 100,
    });
    const input = {
      availableAt: new Date("2026-08-11T10:00:00Z"),
      dedupeKey: "reconcile:synthetic-155",
      jobType: "reconcile" as const,
      maxAttempts: 3,
    };
    const [first, duplicate] = await Promise.all([jobs.enqueue(input), jobs.enqueue(input)]);
    expect(duplicate.id).toBe(first.id);
    expect(
      (await admin.query("SELECT count(*)::int AS count FROM background_jobs")).rows[0],
    ).toEqual({ count: 1 });
  });

  it("reclaims an expired lease without creating duplicate authority", async () => {
    const jobs = new BackgroundJobRepository(admin, {
      backoffBaseMilliseconds: 10,
      backoffMaximumMilliseconds: 100,
      leaseMilliseconds: 100,
    });
    const start = new Date("2026-08-11T10:00:00Z");
    const queued = await jobs.enqueue({
      availableAt: start,
      dedupeKey: "reconcile:crash-155",
      jobType: "reconcile",
      maxAttempts: 3,
    });
    expect((await jobs.leaseNext(WORKER_A, start))?.id).toBe(queued.id);
    const reclaimedAt = new Date(start.getTime() + 101);
    expect(await jobs.reclaimExpiredLeases(reclaimedAt)).toBe(1);
    const next = await jobs.leaseNext(WORKER_B, new Date(reclaimedAt.getTime() + 11));
    expect(next?.id).toBe(queued.id);
    await jobs.complete(queued.id, WORKER_B, new Date(reclaimedAt.getTime() + 12));
    expect(
      (await admin.query("SELECT count(*)::int AS count FROM background_jobs")).rows[0],
    ).toEqual({ count: 1 });
  });
});
