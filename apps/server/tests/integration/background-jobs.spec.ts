import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BackgroundJobRepository } from "../../src/modules/operations/background-jobs.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const WORKER_ONE = "50000000-0000-4000-8000-000000000001";
const WORKER_TWO = "50000000-0000-4000-8000-000000000002";
const START = new Date("2026-01-01T00:00:00.000Z");

describe("PostgreSQL leased background jobs", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let pool: Pool;
  let repository: BackgroundJobRepository;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    pool = new Pool({ connectionString: environment.postgres.connectionUri, max: 5 });
    await applyMigrations(pool);
    repository = new BackgroundJobRepository(pool, {
      backoffBaseMilliseconds: 1_000,
      backoffMaximumMilliseconds: 60_000,
      leaseMilliseconds: 30_000,
    });
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE background_jobs");
  });

  afterAll(async () => {
    await pool.end();
    await environment.stop();
  });

  it("deduplicates a typed job reference by job type and key", async () => {
    const first = await repository.enqueue({
      availableAt: START,
      dedupeKey: "draft:30000000-0000-4000-8000-000000000001",
      jobType: "draft_expire",
      maxAttempts: 5,
    });
    const replay = await repository.enqueue({
      availableAt: START,
      dedupeKey: "draft:30000000-0000-4000-8000-000000000001",
      jobType: "draft_expire",
      maxAttempts: 5,
    });
    expect(replay.id).toBe(first.id);
    const count = await pool.query<{ count: string }>("SELECT count(*) FROM background_jobs");
    expect(count.rows[0]?.count).toBe("1");
  });

  it("uses SKIP LOCKED so concurrent workers lease distinct jobs", async () => {
    for (const suffix of ["one", "two"]) {
      await repository.enqueue({
        availableAt: START,
        dedupeKey: `reconcile:${suffix}`,
        jobType: "reconcile",
        maxAttempts: 3,
      });
    }

    const [one, two] = await Promise.all([
      repository.leaseNext(WORKER_ONE, START),
      repository.leaseNext(WORKER_TWO, START),
    ]);
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    expect(one?.id).not.toBe(two?.id);
    expect(new Set([one?.leaseOwner, two?.leaseOwner])).toEqual(new Set([WORKER_ONE, WORKER_TWO]));
  });

  it("reclaims an expired crash lease and applies deterministic backoff", async () => {
    await repository.enqueue({
      availableAt: START,
      dedupeKey: "export:60000000-0000-4000-8000-000000000001",
      jobType: "export_build",
      maxAttempts: 4,
    });
    const leased = await repository.leaseNext(WORKER_ONE, START);
    expect(leased?.attempts).toBe(1);

    const afterCrash = new Date(START.getTime() + 31_000);
    const reclaimed = await repository.reclaimExpiredLeases(afterCrash);
    expect(reclaimed).toBe(1);
    await expect(repository.leaseNext(WORKER_TWO, afterCrash)).resolves.toBeNull();

    const afterBackoff = new Date(afterCrash.getTime() + 1_000);
    const retry = await repository.leaseNext(WORKER_TWO, afterBackoff);
    expect(retry).toMatchObject({ attempts: 2, leaseOwner: WORKER_TWO });
  });

  it("moves exhausted failures to dead state without storing error text", async () => {
    const job = await repository.enqueue({
      availableAt: START,
      dedupeKey: "provider-delete:70000000-0000-4000-8000-000000000001",
      jobType: "provider_delete",
      maxAttempts: 2,
    });
    const first = await repository.leaseNext(WORKER_ONE, START);
    expect(first?.id).toBe(job.id);
    await repository.fail(job.id, WORKER_ONE, "availability", START);

    const secondLeaseAt = new Date(START.getTime() + 1_000);
    await repository.leaseNext(WORKER_ONE, secondLeaseAt);
    const failed = await repository.fail(job.id, WORKER_ONE, "timeout", secondLeaseAt);
    expect(failed).toMatchObject({ attempts: 2, lastErrorClass: "timeout", state: "dead" });

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'background_jobs'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining(["payload", "error_text", "details"]),
    );
  });

  it("completes only a job held by the current lease owner", async () => {
    const job = await repository.enqueue({
      availableAt: START,
      dedupeKey: "memo:20000000-0000-4000-8000-000000000001",
      jobType: "memo_purge",
      maxAttempts: 3,
    });
    await repository.leaseNext(WORKER_ONE, START);
    await expect(repository.complete(job.id, WORKER_TWO, START)).rejects.toThrow(
      "JOB_LEASE_NOT_OWNED",
    );
    await expect(repository.complete(job.id, WORKER_ONE, START)).resolves.toMatchObject({
      state: "succeeded",
    });
  });

  it("runs a scheduler once only while its PostgreSQL advisory lock is held", async () => {
    const blocker = await pool.connect();
    try {
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        "cashmemo:test-scheduler",
      ]);
      await expect(
        repository.runSchedulerOnce("cashmemo:test-scheduler", () =>
          Promise.reject(new Error("must not execute")),
        ),
      ).resolves.toBe(false);
      await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        "cashmemo:test-scheduler",
      ]);
    } finally {
      blocker.release();
    }

    let calls = 0;
    await expect(
      repository.runSchedulerOnce("cashmemo:test-scheduler", () => {
        calls += 1;
        return Promise.resolve();
      }),
    ).resolves.toBe(true);
    expect(calls).toBe(1);
  });
});
