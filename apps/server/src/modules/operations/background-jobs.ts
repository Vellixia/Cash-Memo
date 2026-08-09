import { randomUUID } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

export const backgroundJobTypes = [
  "draft_expire",
  "memo_purge",
  "account_purge",
  "export_build",
  "export_delete",
  "provider_delete",
  "reconcile",
] as const;
export type BackgroundJobType = (typeof backgroundJobTypes)[number];

export const backgroundJobErrorClasses = [
  "availability",
  "timeout",
  "storage",
  "provider",
  "integrity",
  "policy",
  "unknown",
] as const;
export type BackgroundJobErrorClass = (typeof backgroundJobErrorClasses)[number];

export interface BackgroundJobRepositoryOptions {
  backoffBaseMilliseconds: number;
  backoffMaximumMilliseconds: number;
  leaseMilliseconds: number;
}

export interface EnqueueBackgroundJob {
  availableAt: Date;
  dedupeKey: string;
  jobType: BackgroundJobType;
  maxAttempts: number;
  userIdHmac?: Buffer;
}

export interface BackgroundJob {
  attempts: number;
  availableAt: Date;
  dedupeKey: string;
  id: string;
  jobType: BackgroundJobType;
  lastErrorClass: BackgroundJobErrorClass | null;
  leaseOwner: string | null;
  leasedUntil: Date | null;
  maxAttempts: number;
  state: "dead" | "leased" | "ready" | "retry_wait" | "succeeded";
}

interface BackgroundJobRow extends QueryResultRow {
  attempts: number;
  availableAt: Date;
  dedupeKey: string;
  id: string;
  jobType: BackgroundJobType;
  lastErrorClass: BackgroundJobErrorClass | null;
  leaseOwner: string | null;
  leasedUntil: Date | null;
  maxAttempts: number;
  state: BackgroundJob["state"];
}

const JOB_COLUMNS = `
  id,
  job_type AS "jobType",
  dedupe_key AS "dedupeKey",
  state,
  available_at AS "availableAt",
  leased_until AS "leasedUntil",
  lease_owner AS "leaseOwner",
  attempts,
  max_attempts AS "maxAttempts",
  last_error_class AS "lastErrorClass"`;

const JOB_COLUMNS_FROM_JOB = `
  job.id,
  job.job_type AS "jobType",
  job.dedupe_key AS "dedupeKey",
  job.state,
  job.available_at AS "availableAt",
  job.leased_until AS "leasedUntil",
  job.lease_owner AS "leaseOwner",
  job.attempts,
  job.max_attempts AS "maxAttempts",
  job.last_error_class AS "lastErrorClass"`;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTENT_FREE_DEDUPE_KEY = /^[a-z0-9_-]+:[a-z0-9-]{1,128}$/u;

function assertOptions(options: BackgroundJobRepositoryOptions): void {
  if (
    !Number.isSafeInteger(options.backoffBaseMilliseconds) ||
    !Number.isSafeInteger(options.backoffMaximumMilliseconds) ||
    !Number.isSafeInteger(options.leaseMilliseconds) ||
    options.backoffBaseMilliseconds <= 0 ||
    options.backoffMaximumMilliseconds < options.backoffBaseMilliseconds ||
    options.leaseMilliseconds <= 0
  ) {
    throw new Error("INVALID_BACKGROUND_JOB_OPTIONS");
  }
}

function assertWorkerId(workerId: string): void {
  if (!CANONICAL_UUID.test(workerId)) throw new Error("INVALID_WORKER_ID");
}

function assertEnqueue(input: EnqueueBackgroundJob): void {
  if (!CONTENT_FREE_DEDUPE_KEY.test(input.dedupeKey)) {
    throw new Error("INVALID_CONTENT_FREE_DEDUPE_KEY");
  }
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 100) {
    throw new Error("INVALID_MAX_ATTEMPTS");
  }
}

function backoffMilliseconds(attempts: number, options: BackgroundJobRepositoryOptions): number {
  return Math.min(
    options.backoffMaximumMilliseconds,
    options.backoffBaseMilliseconds * 2 ** Math.max(0, attempts - 1),
  );
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    throw new Error("BACKGROUND_JOB_ROLLBACK_FAILED");
  }
}

export class BackgroundJobRepository {
  constructor(
    private readonly pool: Pool,
    private readonly options: BackgroundJobRepositoryOptions,
  ) {
    assertOptions(options);
  }

  async enqueue(input: EnqueueBackgroundJob): Promise<BackgroundJob> {
    assertEnqueue(input);
    const id = randomUUID();
    const inserted = await this.pool.query<BackgroundJobRow>(
      `INSERT INTO background_jobs (
         id, user_id_hmac, job_type, dedupe_key, state, available_at, attempts, max_attempts
       ) VALUES ($1, $2, $3, $4, 'ready', $5, 0, $6)
       ON CONFLICT (job_type, dedupe_key) DO NOTHING
       RETURNING ${JOB_COLUMNS}`,
      [
        id,
        input.userIdHmac ?? null,
        input.jobType,
        input.dedupeKey,
        input.availableAt,
        input.maxAttempts,
      ],
    );
    const created = inserted.rows[0];
    if (created !== undefined) return created;

    const replay = await this.pool.query<BackgroundJobRow>(
      `SELECT ${JOB_COLUMNS}
       FROM background_jobs
       WHERE job_type = $1 AND dedupe_key = $2`,
      [input.jobType, input.dedupeKey],
    );
    const existing = replay.rows[0];
    if (existing === undefined) throw new Error("BACKGROUND_JOB_DEDUPE_RACE");
    return existing;
  }

  async leaseNext(workerId: string, now: Date): Promise<BackgroundJob | null> {
    assertWorkerId(workerId);
    const leasedUntil = new Date(now.getTime() + this.options.leaseMilliseconds);
    const result = await this.pool.query<BackgroundJobRow>(
      `WITH candidate AS (
         SELECT id
         FROM background_jobs
         WHERE state IN ('ready', 'retry_wait') AND available_at <= $1
         ORDER BY available_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE background_jobs AS job
       SET state = 'leased', leased_until = $2, lease_owner = $3,
           attempts = job.attempts + 1, updated_at = $1
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING ${JOB_COLUMNS_FROM_JOB}`,
      [now, leasedUntil, workerId],
    );
    return result.rows[0] ?? null;
  }

  async reclaimExpiredLeases(now: Date): Promise<number> {
    const result = await this.pool.query(
      `UPDATE background_jobs
       SET state = CASE WHEN attempts >= max_attempts THEN 'dead'::background_job_state
                        ELSE 'retry_wait'::background_job_state END,
           available_at = CASE WHEN attempts >= max_attempts THEN available_at
                               ELSE $1 + LEAST($2 * power(2, GREATEST(attempts - 1, 0)), $3)
                                 * interval '1 millisecond' END,
           leased_until = NULL,
           lease_owner = NULL,
           updated_at = $1
       WHERE state = 'leased' AND leased_until <= $1`,
      [now, this.options.backoffBaseMilliseconds, this.options.backoffMaximumMilliseconds],
    );
    return result.rowCount ?? 0;
  }

  async fail(
    jobId: string,
    workerId: string,
    errorClass: BackgroundJobErrorClass,
    now: Date,
  ): Promise<BackgroundJob> {
    assertWorkerId(workerId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ attempts: number; maxAttempts: number }>(
        `SELECT attempts, max_attempts AS "maxAttempts"
         FROM background_jobs
         WHERE id = $1 AND state = 'leased' AND lease_owner = $2
         FOR UPDATE`,
        [jobId, workerId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new Error("JOB_LEASE_NOT_OWNED");
      const exhausted = row.attempts >= row.maxAttempts;
      const availableAt = exhausted
        ? now
        : new Date(now.getTime() + backoffMilliseconds(row.attempts, this.options));
      const updated = await client.query<BackgroundJobRow>(
        `UPDATE background_jobs
         SET state = $3, available_at = $4, leased_until = NULL, lease_owner = NULL,
             last_error_class = $5, updated_at = $6
         WHERE id = $1 AND lease_owner = $2
         RETURNING ${JOB_COLUMNS}`,
        [jobId, workerId, exhausted ? "dead" : "retry_wait", availableAt, errorClass, now],
      );
      await client.query("COMMIT");
      const result = updated.rows[0];
      if (result === undefined) throw new Error("JOB_LEASE_NOT_OWNED");
      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(jobId: string, workerId: string, now: Date): Promise<BackgroundJob> {
    assertWorkerId(workerId);
    const result = await this.pool.query<BackgroundJobRow>(
      `UPDATE background_jobs
       SET state = 'succeeded', leased_until = NULL, lease_owner = NULL, updated_at = $3
       WHERE id = $1 AND state = 'leased' AND lease_owner = $2
       RETURNING ${JOB_COLUMNS}`,
      [jobId, workerId, now],
    );
    const completed = result.rows[0];
    if (completed === undefined) throw new Error("JOB_LEASE_NOT_OWNED");
    return completed;
  }

  async runSchedulerOnce(name: string, operation: () => Promise<void>): Promise<boolean> {
    if (!/^[a-z0-9:_-]{1,100}$/u.test(name)) throw new Error("INVALID_SCHEDULER_NAME");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired",
        [name],
      );
      if (lock.rows[0]?.acquired !== true) {
        await client.query("ROLLBACK");
        return false;
      }
      await operation();
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
