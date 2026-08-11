import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ContractExportObjectStore } from "../../src/adapters/aws/export-object-store.adapter.js";
import { ExportJobService } from "../../src/modules/export/export-job.service.js";
import { BackgroundJobRepository } from "../../src/modules/operations/background-jobs.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000166";
const OTHER = "00000000-0000-4000-8000-000000000167";
const WORKER = "10000000-0000-4000-8000-000000000166";
const NOW = new Date("2026-08-11T12:00:00.000Z");
const HMAC = Buffer.from("synthetic-export-job-hmac-key-material-v1", "utf8");
const REFERENCE = Buffer.from("synthetic-export-object-reference-key-v1", "utf8");

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("export job lifecycle against real PostgreSQL", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;
  let workerPool: Pool;
  let clock = new Date(NOW);
  let store: ContractExportObjectStore;
  let service: ExportJobService;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL missing");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'export-owner@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'export-other@cashmemo.test', true, 'active')`,
      [ACCOUNT, OTHER],
    );
    for (const account of [ACCOUNT, OTHER]) {
      await admin.query(
        `INSERT INTO profiles
           (user_id, onboarding_state, privacy_notice_version, privacy_notice_accepted_at)
         VALUES ($1, 'complete', 'privacy-v1', $2)`,
        [account, NOW],
      );
      await admin.query(
        `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
         VALUES ($1, 'USD', 'UTC', 'en-US')`,
        [account],
      );
    }
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
    workerPool = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_worker",
    });
  }, 120_000);

  beforeEach(async () => {
    clock = new Date(NOW);
    await admin.query("DELETE FROM background_jobs");
    await admin.query("DELETE FROM export_jobs");
    await admin.query("DELETE FROM idempotency_records");
    await admin.query("DELETE FROM compose_drafts");
    await admin.query("DELETE FROM money_memos");
    await admin.query("DELETE FROM categories");
    await admin.query("DELETE FROM money_spaces");
    await admin.query(
      `INSERT INTO categories (id, user_id, kind, name, normalized_name)
       VALUES ('20000000-0000-4000-8000-000000000166', $1, 'expense', 'Synthetic', 'synthetic')`,
      [ACCOUNT],
    );
    await admin.query(
      `INSERT INTO money_memos (
         id, user_id, direction, amount_minor, currency_code, currency_exponent,
         currency_registry_version, occurred_at, occurred_local, occurred_timezone,
         occurred_offset_minutes, timezone_database_version, category_id, note, origin,
         lifecycle_state, revision
       ) VALUES (
         '30000000-0000-4000-8000-000000000166', $1, 'expense', 1250, 'USD', 2,
         'registry-v1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00', 'UTC', 0,
         '2026a', '20000000-0000-4000-8000-000000000166', '=formula-safe', 'manual',
         'active', 1
       )`,
      [ACCOUNT],
    );
    await admin.query(
      `INSERT INTO compose_drafts (
         id, user_id, origin, source_text, source_completeness, candidate_fields,
         field_provenance, capture_started_at, capture_timezone, status,
         last_activity_at, expires_at, revision
       ) VALUES (
         '40000000-0000-4000-8000-000000000166', $1, 'manual', 'synthetic draft',
         'incomplete', '{}'::jsonb, '{}'::jsonb, $2, 'UTC', 'editing', $2,
         $2::timestamptz + interval '7 days', 1
       )`,
      [ACCOUNT, NOW],
    );
    store = new ContractExportObjectStore();
    service = new ExportJobService({
      backgroundJobs: new BackgroundJobRepository(workerPool, {
        backoffBaseMilliseconds: 10,
        backoffMaximumMilliseconds: 100,
        leaseMilliseconds: 1_000,
      }),
      hmacKey: HMAC,
      now: () => clock,
      objectReferenceKey: REFERENCE,
      objectStore: store,
      pool: runtime,
    });
  });

  afterAll(async () => {
    await workerPool.end();
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  it("creates one queued job for idempotent request replay", async () => {
    const key = crypto.randomUUID();
    const first = await service.request(ACCOUNT, {
      idempotencyKey: key,
      includeRecoverableDrafts: true,
      schemaVersion: "1.0",
    });
    const replay = await service.request(ACCOUNT, {
      idempotencyKey: key,
      includeRecoverableDrafts: true,
      schemaVersion: "1.0",
    });
    expect(replay.id).toBe(first.id);
    expect((await admin.query("SELECT count(*)::int AS count FROM export_jobs")).rows[0]).toEqual({
      count: 1,
    });
    expect(
      (await admin.query("SELECT count(*)::int AS count FROM background_jobs")).rows[0],
    ).toEqual({
      count: 1,
    });
  });

  it("rejects conflicting payload reuse", async () => {
    const key = crypto.randomUUID();
    await service.request(ACCOUNT, {
      idempotencyKey: key,
      includeRecoverableDrafts: true,
      schemaVersion: "1.0",
    });
    await expect(
      service.request(ACCOUNT, {
        idempotencyKey: key,
        includeRecoverableDrafts: false,
        schemaVersion: "1.0",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("leases, builds, verifies, and exposes only complete deterministic ZIP", async () => {
    const queued = await service.request(ACCOUNT, {
      idempotencyKey: crypto.randomUUID(),
      includeRecoverableDrafts: true,
      schemaVersion: "1.0",
    });
    const ready = await service.process(ACCOUNT, queued.id, true, WORKER);
    expect(ready.state).toBe("ready");
    if (ready.expiresAt === null || ready.readyAt === null) throw new Error("EXPORT_DATES_MISSING");
    expect(Date.parse(ready.expiresAt) - Date.parse(ready.readyAt)).toBe(24 * 60 * 60 * 1_000);
    const bytes = await streamBytes(await service.download(ACCOUNT, queued.id));
    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect((await admin.query("SELECT state FROM background_jobs")).rows[0]).toEqual({
      state: "succeeded",
    });
  });

  it("does not create another logical artifact on repeated worker delivery", async () => {
    const queued = await service.request(ACCOUNT, {
      idempotencyKey: crypto.randomUUID(),
      includeRecoverableDrafts: false,
      schemaVersion: "1.0",
    });
    const first = await service.process(ACCOUNT, queued.id, false, WORKER);
    const replay = await service.process(
      ACCOUNT,
      queued.id,
      false,
      "10000000-0000-4000-8000-000000000167",
    );
    expect(replay).toEqual(first);
    expect((await admin.query("SELECT count(*)::int AS count FROM export_jobs")).rows[0]).toEqual({
      count: 1,
    });
  });

  it("cancellation removes every object version and blocks download", async () => {
    const queued = await service.request(ACCOUNT, {
      idempotencyKey: crypto.randomUUID(),
      includeRecoverableDrafts: false,
      schemaVersion: "1.0",
    });
    const ready = await service.process(ACCOUNT, queued.id, false, WORKER);
    const canceled = await service.cancel(ACCOUNT, ready.id, ready.revision);
    expect(canceled.state).toBe("canceled");
    expect(canceled.deletedAt).not.toBeNull();
    await expect(service.download(ACCOUNT, ready.id)).rejects.toMatchObject({
      code: "EXPORT_NOT_READY",
    });
  });

  it("expires and deletes package versions under controlled time", async () => {
    const queued = await service.request(ACCOUNT, {
      idempotencyKey: crypto.randomUUID(),
      includeRecoverableDrafts: false,
      schemaVersion: "1.0",
    });
    const ready = await service.process(ACCOUNT, queued.id, false, WORKER);
    if (ready.expiresAt === null) throw new Error("EXPORT_EXPIRY_MISSING");
    clock = new Date(ready.expiresAt);
    await expect(service.expireDue(ACCOUNT)).resolves.toBe(1);
    expect((await service.get(ACCOUNT, ready.id)).state).toBe("expired");
    await expect(service.download(ACCOUNT, ready.id)).rejects.toMatchObject({
      code: "EXPORT_NOT_READY",
    });
  });

  it("keeps another account outside status and download", async () => {
    const queued = await service.request(ACCOUNT, {
      idempotencyKey: crypto.randomUUID(),
      includeRecoverableDrafts: false,
      schemaVersion: "1.0",
    });
    await service.process(ACCOUNT, queued.id, false, WORKER);
    await expect(service.get(OTHER, queued.id)).rejects.toMatchObject({ code: "EXPORT_NOT_FOUND" });
    await expect(service.download(OTHER, queued.id)).rejects.toMatchObject({
      code: "EXPORT_NOT_FOUND",
    });
  });
});
