import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { canonicalRequestHmac, Money, serializeMoney } from "@cashmemo/domain";

import type { Pool, QueryResultRow } from "pg";

import type { ExportObjectStore } from "../../adapters/rustfs/export-object-store.adapter.js";
import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import type { BackgroundJobRepository } from "../operations/background-jobs.js";
import {
  serializeExportV1,
  type ExportCategory,
  type ExportDraft,
  type ExportLifecycleEntry,
  type ExportMoneyMemo,
  type ExportMoneySpace,
  type ExportPreference,
  type ExportV1Snapshot,
} from "./export-v1.serializer.js";

type ExportJobState =
  "canceled" | "deleted" | "deleting" | "expired" | "failed" | "queued" | "ready" | "running";

interface ExportJobView {
  readonly deletedAt: string | null;
  readonly expiresAt: string | null;
  readonly failureCode: "DELETION_PENDING" | "GENERATION_FAILED" | "STORAGE_UNAVAILABLE" | null;
  readonly id: string;
  readonly readyAt: string | null;
  readonly requestedAt: string;
  readonly revision: string;
  readonly schemaVersion: "1.0";
  readonly state: ExportJobState;
}

interface ExportRequest {
  readonly idempotencyKey: string;
  readonly includeRecoverableDrafts: boolean;
  readonly schemaVersion: "1.0";
}

interface ExportJobServiceOptions {
  readonly backgroundJobs: BackgroundJobRepository;
  readonly hmacKey: Buffer;
  readonly now?: () => Date;
  readonly objectReferenceKey: Buffer;
  readonly objectStore: ExportObjectStore;
  readonly pool: Pool;
}

interface ExportJobRow extends QueryResultRow {
  readonly deleted_at: Date | null;
  readonly expires_at: Date | null;
  readonly failure_class: string | null;
  readonly id: string;
  readonly manifest_sha256: Buffer | null;
  readonly object_key_ciphertext: Buffer | null;
  readonly ready_at: Date | null;
  readonly requested_at: Date;
  readonly revision: string;
  readonly schema_version: string;
  readonly snapshot_cutoff: Date;
  readonly state: ExportJobState;
}

interface ObjectReference {
  readonly archiveSha256: string;
  readonly key: string;
}

class ExportJobServiceError extends Error {
  constructor(
    readonly code:
      | "EXPORT_NOT_FOUND"
      | "EXPORT_NOT_READY"
      | "IDEMPOTENCY_CONFLICT"
      | "OPERATION_IN_PROGRESS"
      | "REVISION_CONFLICT"
      | "STATE_CONFLICT"
      | "VALIDATION_ERROR",
  ) {
    super(code);
    this.name = "ExportJobServiceError";
  }
}

const UTC_SQL = `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`;
const LOCAL_SQL = `YYYY-MM-DD"T"HH24:MI:SS.MS`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function dateString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function failureCode(value: string | null): ExportJobView["failureCode"] {
  if (value === null) return null;
  if (value === "storage") return "STORAGE_UNAVAILABLE";
  if (value === "integrity") return "GENERATION_FAILED";
  return "GENERATION_FAILED";
}

function mapJob(row: ExportJobRow): ExportJobView {
  if (row.schema_version !== "1.0") throw new Error("UNSUPPORTED_EXPORT_SCHEMA");
  return Object.freeze({
    deletedAt: dateString(row.deleted_at),
    expiresAt: dateString(row.expires_at),
    failureCode: failureCode(row.failure_class),
    id: row.id,
    readyAt: dateString(row.ready_at),
    requestedAt: row.requested_at.toISOString(),
    revision: row.revision,
    schemaVersion: "1.0",
    state: row.state,
  });
}

function sameBuffer(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function accountScopeHmac(key: Buffer, accountId: string): string {
  return createHmac("sha256", key).update(`export-scope:${accountId}`, "utf8").digest("hex");
}

function encryptReference(reference: Readonly<ObjectReference>, keyMaterial: Buffer): Buffer {
  const key = createHash("sha256").update(keyMaterial).digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(reference), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function decryptReference(value: Buffer, keyMaterial: Buffer): ObjectReference {
  if (value.length < 29) throw new Error("INVALID_EXPORT_OBJECT_REFERENCE");
  const key = createHash("sha256").update(keyMaterial).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  const plaintext = Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<ObjectReference>;
  if (
    typeof parsed.key !== "string" ||
    typeof parsed.archiveSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(parsed.archiveSha256)
  ) {
    throw new Error("INVALID_EXPORT_OBJECT_REFERENCE");
  }
  return { archiveSha256: parsed.archiveSha256, key: parsed.key };
}

function dedupeKey(exportId: string, includeRecoverableDrafts: boolean): string {
  return `export-d${includeRecoverableDrafts ? "1" : "0"}:${exportId}`;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

class ExportJobService {
  private readonly backgroundJobs: BackgroundJobRepository;
  private readonly hmacKey: Buffer;
  private readonly now: () => Date;
  private readonly objectReferenceKey: Buffer;
  private readonly objectStore: ExportObjectStore;
  private readonly pool: Pool;
  private readonly snapshotCache = new Map<string, ExportV1Snapshot>();

  constructor(options: Readonly<ExportJobServiceOptions>) {
    this.backgroundJobs = options.backgroundJobs;
    this.hmacKey = options.hmacKey;
    this.objectReferenceKey = options.objectReferenceKey;
    this.objectStore = options.objectStore;
    this.pool = options.pool;
    this.now = options.now ?? (() => new Date());
  }

  async request(accountId: string, input: Readonly<ExportRequest>): Promise<ExportJobView> {
    if (!UUID.test(input.idempotencyKey)) {
      throw new ExportJobServiceError("VALIDATION_ERROR");
    }
    const requestHmac = Buffer.from(
      canonicalRequestHmac({
        hmacKey: this.hmacKey,
        operation: "export",
        payload: {
          includeRecoverableDrafts: input.includeRecoverableDrafts,
          schemaVersion: input.schemaVersion,
        },
        schemaVersion: "export-request-v1",
      }),
      "hex",
    );
    const now = this.now();
    const exportId = randomUUID();
    const result = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const existing = await transaction.query<{
        readonly request_hmac: Buffer;
        readonly result_id: string | null;
        readonly state: string;
      }>(
        `SELECT request_hmac, result_id, state
         FROM idempotency_records
         WHERE user_id = $1 AND operation = 'export' AND key = $2`,
        [accountId, input.idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        if (!sameBuffer(replay.request_hmac, requestHmac)) {
          throw new ExportJobServiceError("IDEMPOTENCY_CONFLICT");
        }
        if (replay.state === "in_progress" || replay.result_id === null) {
          throw new ExportJobServiceError("OPERATION_IN_PROGRESS");
        }
        const found = await transaction.query<ExportJobRow>(
          "SELECT * FROM export_jobs WHERE user_id = $1 AND id = $2",
          [accountId, replay.result_id],
        );
        const row = found.rows[0];
        if (row === undefined) throw new ExportJobServiceError("EXPORT_NOT_FOUND");
        return { created: false, job: mapJob(row) };
      }

      await transaction.query(
        `INSERT INTO idempotency_records
           (id, user_id, operation, key, request_hmac, state, expires_at)
         VALUES ($1, $2, 'export', $3, $4, 'in_progress', now() + interval '35 days')`,
        [randomUUID(), accountId, input.idempotencyKey, requestHmac],
      );
      const inserted = await transaction.query<ExportJobRow>(
        `INSERT INTO export_jobs
           (id, user_id, schema_version, requested_at, state, snapshot_cutoff, revision)
         VALUES ($1, $2, '1.0', $3, 'queued', $3, 1)
         RETURNING *`,
        [exportId, accountId, now],
      );
      await transaction.query(
        `UPDATE idempotency_records
         SET state = 'succeeded', result_type = 'export', result_id = $1,
             result_revision = 1, response_code = 'accepted', updated_at = $2
         WHERE user_id = $3 AND operation = 'export' AND key = $4`,
        [exportId, now, accountId, input.idempotencyKey],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("EXPORT_CREATE_FAILED");
      return { created: true, job: mapJob(row) };
    });
    if (result.created) {
      try {
        await this.backgroundJobs.enqueue({
          availableAt: now,
          dedupeKey: dedupeKey(result.job.id, input.includeRecoverableDrafts),
          jobType: "export_build",
          maxAttempts: 5,
          userIdHmac: Buffer.from(accountScopeHmac(this.hmacKey, accountId), "hex"),
        });
      } catch (error) {
        await withAccountTransaction(this.pool, accountId, async (transaction) => {
          await transaction.query(
            `UPDATE export_jobs SET state = 'failed', failure_class = 'availability',
                    updated_at = $3, revision = revision + 1
             WHERE user_id = $1 AND id = $2 AND state = 'queued'`,
            [accountId, result.job.id, now],
          );
        });
        throw error;
      }
    }
    return result.job;
  }

  async process(
    accountId: string,
    exportId: string,
    includeRecoverableDrafts: boolean,
    workerId: string,
  ): Promise<ExportJobView> {
    const now = this.now();
    const key = dedupeKey(exportId, includeRecoverableDrafts);
    const lease = await this.backgroundJobs.leaseByDedupeKey("export_build", key, workerId, now);
    if (lease === null) return this.get(accountId, exportId);
    let objectKey: string | null = null;
    try {
      const running = await withAccountTransaction(this.pool, accountId, async (transaction) => {
        const result = await transaction.query<ExportJobRow>(
          `UPDATE export_jobs
           SET state = 'running', failure_class = NULL, updated_at = $3, revision = revision + 1
           WHERE user_id = $1 AND id = $2 AND state IN ('queued', 'failed')
           RETURNING *`,
          [accountId, exportId, now],
        );
        const row = result.rows[0];
        if (row === undefined) throw new ExportJobServiceError("STATE_CONFLICT");
        return row;
      });
      const snapshot =
        this.snapshotCache.get(exportId) ??
        (await this.loadSnapshot(accountId, running, includeRecoverableDrafts));
      this.snapshotCache.set(exportId, snapshot);
      const serialized = serializeExportV1(snapshot);
      const readyAt = this.now();
      const expiresAt = new Date(readyAt.getTime() + 24 * 60 * 60 * 1_000);
      const scope = accountScopeHmac(this.hmacKey, accountId);
      const stored = await this.objectStore.putPrivateExport({
        accountScopeHmac: scope,
        body: serialized.archive,
        expectedSha256: serialized.archiveSha256,
        expiresAt,
      });
      objectKey = stored.key;
      const verification = await readStream(
        await this.objectStore.openPrivateStream(scope, stored.key, serialized.archiveSha256),
      );
      if (createHash("sha256").update(verification).digest("hex") !== serialized.archiveSha256) {
        throw new Error("EXPORT_INTEGRITY_MISMATCH");
      }
      const reference = encryptReference(
        { archiveSha256: serialized.archiveSha256, key: stored.key },
        this.objectReferenceKey,
      );
      const completed = await withAccountTransaction(this.pool, accountId, async (transaction) => {
        const result = await transaction.query<ExportJobRow>(
          `UPDATE export_jobs
           SET state = 'ready', object_key_ciphertext = $3, manifest_sha256 = $4,
               ready_at = $5, expires_at = $6, updated_at = $5, revision = revision + 1
           WHERE user_id = $1 AND id = $2 AND state = 'running'
           RETURNING *`,
          [
            accountId,
            exportId,
            reference,
            Buffer.from(serialized.manifestSha256, "hex"),
            readyAt,
            expiresAt,
          ],
        );
        const row = result.rows[0];
        if (row === undefined) throw new ExportJobServiceError("STATE_CONFLICT");
        return mapJob(row);
      });
      await this.backgroundJobs.complete(lease.id, workerId, this.now());
      return completed;
    } catch (error) {
      if (objectKey !== null) {
        await this.objectStore
          .deleteEveryVersion(accountScopeHmac(this.hmacKey, accountId), objectKey)
          .catch(() => undefined);
      }
      await withAccountTransaction(this.pool, accountId, async (transaction) => {
        await transaction.query(
          `UPDATE export_jobs
           SET state = 'failed', failure_class = $3, updated_at = $4, revision = revision + 1
           WHERE user_id = $1 AND id = $2 AND state = 'running'`,
          [
            accountId,
            exportId,
            error instanceof Error && error.message.includes("INTEGRITY") ? "integrity" : "storage",
            this.now(),
          ],
        );
      });
      await this.backgroundJobs.fail(lease.id, workerId, "storage", this.now());
      throw error;
    }
  }

  async get(accountId: string, exportId: string): Promise<ExportJobView> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<ExportJobRow>(
        "SELECT * FROM export_jobs WHERE user_id = $1 AND id = $2",
        [accountId, exportId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new ExportJobServiceError("EXPORT_NOT_FOUND");
      return mapJob(row);
    });
  }

  async list(accountId: string): Promise<readonly ExportJobView[]> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<ExportJobRow>(
        `SELECT * FROM export_jobs WHERE user_id = $1 ORDER BY requested_at DESC, id DESC`,
        [accountId],
      );
      return result.rows.map(mapJob);
    });
  }

  async download(accountId: string, exportId: string): Promise<NodeJS.ReadableStream> {
    const row = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<ExportJobRow>(
        "SELECT * FROM export_jobs WHERE user_id = $1 AND id = $2",
        [accountId, exportId],
      );
      const current = result.rows[0];
      if (current === undefined) throw new ExportJobServiceError("EXPORT_NOT_FOUND");
      return current;
    });
    if (
      row.state !== "ready" ||
      row.expires_at === null ||
      row.expires_at <= this.now() ||
      row.object_key_ciphertext === null
    ) {
      throw new ExportJobServiceError("EXPORT_NOT_READY");
    }
    const reference = decryptReference(row.object_key_ciphertext, this.objectReferenceKey);
    return this.objectStore.openPrivateStream(
      accountScopeHmac(this.hmacKey, accountId),
      reference.key,
      reference.archiveSha256,
    );
  }

  async cancel(
    accountId: string,
    exportId: string,
    expectedRevision: string,
  ): Promise<ExportJobView> {
    const now = this.now();
    const row = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<ExportJobRow>(
        `UPDATE export_jobs
         SET state = 'canceled', updated_at = $4, revision = revision + 1
         WHERE user_id = $1 AND id = $2 AND revision = $3
           AND state IN ('queued', 'running', 'ready', 'failed')
         RETURNING *`,
        [accountId, exportId, expectedRevision, now],
      );
      const updated = result.rows[0];
      if (updated !== undefined) return updated;
      const found = await transaction.query<ExportJobRow>(
        "SELECT * FROM export_jobs WHERE user_id = $1 AND id = $2",
        [accountId, exportId],
      );
      if (found.rows[0] === undefined) throw new ExportJobServiceError("EXPORT_NOT_FOUND");
      if (found.rows[0].revision !== expectedRevision) {
        throw new ExportJobServiceError("REVISION_CONFLICT");
      }
      throw new ExportJobServiceError("STATE_CONFLICT");
    });
    await this.deleteObject(accountId, row, now);
    return this.get(accountId, exportId);
  }

  async expireDue(accountId: string, now = this.now()): Promise<number> {
    const due = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<ExportJobRow>(
        `UPDATE export_jobs
         SET state = 'expired', updated_at = $2, revision = revision + 1
         WHERE user_id = $1 AND state = 'ready' AND expires_at <= $2
         RETURNING *`,
        [accountId, now],
      );
      return result.rows;
    });
    for (const row of due) await this.deleteObject(accountId, row, now);
    return due.length;
  }

  async deleteAllForAccount(accountId: string): Promise<void> {
    const rows = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<ExportJobRow>(
        "SELECT * FROM export_jobs WHERE user_id = $1 ORDER BY id",
        [accountId],
      );
      return result.rows;
    });
    for (const row of rows) {
      if (row.object_key_ciphertext !== null) {
        const reference = decryptReference(row.object_key_ciphertext, this.objectReferenceKey);
        const deleted = await this.objectStore.deleteEveryVersion(
          accountScopeHmac(this.hmacKey, accountId),
          reference.key,
        );
        if (deleted.residualVersions !== 0) throw new Error("EXPORT_VERSION_DELETION_INCOMPLETE");
      }
      this.snapshotCache.delete(row.id);
    }
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      await transaction.query("DELETE FROM export_jobs WHERE user_id = $1", [accountId]);
    });
  }

  private async deleteObject(accountId: string, row: ExportJobRow, now: Date): Promise<void> {
    if (row.object_key_ciphertext !== null) {
      const reference = decryptReference(row.object_key_ciphertext, this.objectReferenceKey);
      const deleted = await this.objectStore.deleteEveryVersion(
        accountScopeHmac(this.hmacKey, accountId),
        reference.key,
      );
      if (deleted.residualVersions !== 0) throw new Error("EXPORT_VERSION_DELETION_INCOMPLETE");
    }
    this.snapshotCache.delete(row.id);
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      await transaction.query(
        `UPDATE export_jobs SET deleted_at = $3, updated_at = $3, revision = revision + 1
         WHERE user_id = $1 AND id = $2 AND state IN ('canceled', 'expired')`,
        [accountId, row.id, now],
      );
    });
  }

  private async loadSnapshot(
    accountId: string,
    job: ExportJobRow,
    includeRecoverableDrafts: boolean,
  ): Promise<ExportV1Snapshot> {
    return withAccountTransaction(
      this.pool,
      accountId,
      async (transaction) => {
        const preferences = await transaction.query<{
          accepted_privacy_notice_at: Date;
          accepted_privacy_notice_version: string;
          default_currency: string;
          locale: string;
          reporting_timezone: string;
          revision: string;
        }>(
          `SELECT p.default_currency, p.reporting_timezone, p.locale, p.revision::text,
                  pr.privacy_notice_version AS accepted_privacy_notice_version,
                  pr.privacy_notice_accepted_at AS accepted_privacy_notice_at
           FROM preferences p JOIN profiles pr ON pr.user_id = p.user_id
           WHERE p.user_id = $1`,
          [accountId],
        );
        const preferenceRow = preferences.rows[0];
        if (preferenceRow === undefined) throw new Error("EXPORT_SNAPSHOT_INCOMPLETE");
        const preference: ExportPreference = {
          acceptedPrivacyNoticeAt: preferenceRow.accepted_privacy_notice_at.toISOString(),
          acceptedPrivacyNoticeVersion: preferenceRow.accepted_privacy_notice_version,
          defaultCurrency: preferenceRow.default_currency,
          locale: preferenceRow.locale,
          reportingTimezone: preferenceRow.reporting_timezone,
          revision: preferenceRow.revision,
        };

        const categoryResult = await transaction.query<{
          created_at: Date;
          id: string;
          kind: "expense" | "income";
          name: string;
          normalized_name: string;
          revision: string;
          status: "active" | "inactive";
          updated_at: Date;
        }>(`SELECT *, revision::text FROM categories WHERE user_id = $1`, [accountId]);
        const categories: ExportCategory[] = categoryResult.rows.map((row) => ({
          createdAt: row.created_at.toISOString(),
          id: row.id,
          kind: row.kind,
          name: row.name,
          normalizedName: row.normalized_name,
          revision: row.revision,
          status: row.status,
          updatedAt: row.updated_at.toISOString(),
        }));

        const spaceResult = await transaction.query<{
          created_at: Date;
          id: string;
          name: string;
          normalized_name: string;
          revision: string;
          status: "active" | "inactive";
          updated_at: Date;
        }>(`SELECT *, revision::text FROM money_spaces WHERE user_id = $1`, [accountId]);
        const moneySpaces: ExportMoneySpace[] = spaceResult.rows.map((row) => ({
          createdAt: row.created_at.toISOString(),
          id: row.id,
          name: row.name,
          normalizedName: row.normalized_name,
          revision: row.revision,
          status: row.status,
          updatedAt: row.updated_at.toISOString(),
        }));

        const memoResult = await transaction.query<{
          amount_minor: string;
          category_id: string | null;
          created_at: string;
          currency_code: string;
          currency_exponent: number;
          currency_registry_version: string;
          direction: "expense" | "income";
          id: string;
          lifecycle_state: "active" | "archived";
          money_space_id: string | null;
          note: string | null;
          occurred_at: string;
          occurred_local: string;
          occurred_offset_minutes: number;
          occurred_timezone: string;
          origin: "manual" | "natural_language" | "voice";
          planning_status: "planned" | "unplanned" | null;
          purpose: "mixed" | "personal" | "work" | null;
          revision: string;
          timezone_database_version: string;
          updated_at: string;
        }>(
          `SELECT m.id, m.direction, m.amount_minor::text, m.currency_code,
                  m.currency_exponent, m.currency_registry_version,
                  to_char(m.occurred_at AT TIME ZONE 'UTC', '${UTC_SQL}') AS occurred_at,
                  to_char(m.occurred_local, '${LOCAL_SQL}') AS occurred_local,
                  m.occurred_timezone, m.occurred_offset_minutes, m.timezone_database_version,
                  m.category_id, m.money_space_id, m.purpose, m.planning_status, m.note,
                  m.origin, m.lifecycle_state, m.revision::text,
                  to_char(m.created_at AT TIME ZONE 'UTC', '${UTC_SQL}') AS created_at,
                  to_char(m.updated_at AT TIME ZONE 'UTC', '${UTC_SQL}') AS updated_at
           FROM money_memos m
           WHERE m.user_id = $1 AND m.lifecycle_state IN ('active', 'archived')
           ORDER BY m.occurred_at, m.id`,
          [accountId],
        );
        const moneyMemos: ExportMoneyMemo[] = memoResult.rows.map((row) => {
          const money = serializeMoney(
            Money.fromMinor({
              amountMinor: row.amount_minor,
              currency: row.currency_code,
              currencyExponent: row.currency_exponent,
              currencyRegistryVersion: row.currency_registry_version,
            }),
          );
          return {
            amount: money.amount,
            amountMinor: row.amount_minor,
            authoritative: true,
            categoryId: row.category_id,
            createdAt: row.created_at,
            currency: row.currency_code,
            currencyExponent: row.currency_exponent,
            currencyRegistryVersion: row.currency_registry_version,
            direction: row.direction,
            id: row.id,
            lifecycle: row.lifecycle_state,
            moneySpaceId: row.money_space_id,
            note: row.note,
            occurredAt: row.occurred_at,
            occurredLocal: row.occurred_local,
            occurredOffsetMinutes: row.occurred_offset_minutes,
            occurredTimezone: row.occurred_timezone,
            origin: row.origin,
            planningStatus: row.planning_status,
            purpose: row.purpose,
            revision: row.revision,
            timezoneDatabaseVersion: row.timezone_database_version,
            updatedAt: row.updated_at,
          };
        });

        const draftResult = includeRecoverableDrafts
          ? await transaction.query<{
              candidate_fields: Readonly<Record<string, unknown>>;
              capture_started_at: Date;
              capture_timezone: string;
              created_at: Date;
              expires_at: Date;
              id: string;
              last_activity_at: Date;
              origin: "manual" | "natural_language" | "voice";
              revision: string;
              source_completeness: "complete" | "incomplete" | "not_applicable";
              source_text: string | null;
              status: ExportDraft["status"];
            }>(
              `SELECT *, revision::text FROM compose_drafts
               WHERE user_id = $1 AND expires_at > $2
               ORDER BY created_at, id`,
              [accountId, job.snapshot_cutoff],
            )
          : { rows: [] };
        const drafts: ExportDraft[] = draftResult.rows.map((row) => ({
          authoritative: false,
          captureStartedAt: row.capture_started_at.toISOString(),
          captureTimezone: row.capture_timezone,
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          fields: row.candidate_fields,
          id: row.id,
          lastActivityAt: row.last_activity_at.toISOString(),
          origin: row.origin,
          revision: row.revision,
          sourceCompleteness: row.source_completeness,
          sourceText: row.source_text,
          status: row.status,
        }));

        const deletedResult = await transaction.query<{
          deleted_at: Date;
          id: string;
          prior_lifecycle_state: "active" | "archived";
          purge_after: Date;
        }>(
          `SELECT id, deleted_at, purge_after, prior_lifecycle_state
           FROM money_memos WHERE user_id = $1 AND lifecycle_state = 'recently_deleted'
           ORDER BY deleted_at, id`,
          [accountId],
        );
        const lifecycle: ExportLifecycleEntry[] = deletedResult.rows.map((row) => ({
          deletedAt: row.deleted_at.toISOString(),
          eventTime: row.deleted_at.toISOString(),
          priorState: row.prior_lifecycle_state,
          purgeAfter: row.purge_after.toISOString(),
          state: "recently_deleted",
          subjectId: row.id,
          subjectType: "money_memo",
        }));
        lifecycle.push({
          deletedAt: null,
          eventTime: job.requested_at.toISOString(),
          priorState: null,
          purgeAfter: null,
          state: "running",
          subjectId: job.id,
          subjectType: "export",
        });
        const currencyRegistryVersions = [
          ...new Set(moneyMemos.map((memo) => memo.currencyRegistryVersion)),
        ];
        return {
          accountId,
          categories,
          createdAt: job.snapshot_cutoff.toISOString(),
          currencyRegistryVersions,
          drafts,
          exportId: job.id,
          includeRecoverableDrafts,
          lifecycle,
          moneyMemos,
          moneySpaces,
          preferences: preference,
          snapshotCutoff: job.snapshot_cutoff.toISOString(),
        };
      },
      { isolationLevel: "repeatable read" },
    );
  }
}

export {
  ExportJobService,
  ExportJobServiceError,
  accountScopeHmac,
  decryptReference,
  dedupeKey,
  encryptReference,
  type ExportJobServiceOptions,
  type ExportJobState,
  type ExportJobView,
  type ExportRequest,
};
