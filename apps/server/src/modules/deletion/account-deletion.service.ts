import { randomUUID, timingSafeEqual } from "node:crypto";

import { canonicalRequestHmac } from "@cashmemo/domain";

import type { Pool, QueryResultRow } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

type AccountDeletionState =
  "canceled" | "complete" | "failed" | "grace" | "live_purged" | "provider_pending" | "purging";

type ProviderSummaryState = "confirmed" | "escalated" | "not_required" | "not_started" | "pending";

interface AccountDeletionView {
  readonly graceEndsAt: string;
  readonly id: string;
  readonly irreversibleAt: string | null;
  readonly livePurgeDueAt: string | null;
  readonly livePurgedAt: string | null;
  readonly providerState: ProviderSummaryState;
  readonly requestedAt: string;
  readonly revision: string;
  readonly state: AccountDeletionState;
}

interface AccountDeletionServiceOptions {
  readonly cancelExports?: (accountId: string) => Promise<void>;
  readonly hmacKey: Buffer;
  readonly now?: () => Date;
  readonly pool: Pool;
}

interface AccountDeletionRow extends QueryResultRow {
  readonly completed_at: Date | null;
  readonly failure_class: string | null;
  readonly grace_ends_at: Date;
  readonly id: string;
  readonly irreversible_at: Date | null;
  readonly live_purge_due_at: Date | null;
  readonly live_purged_at: Date | null;
  readonly requested_at: Date;
  readonly revision: string;
  readonly state: AccountDeletionState;
}

class AccountDeletionServiceError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_DELETION_NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "IRREVERSIBLE_DELETION"
      | "OPERATION_IN_PROGRESS"
      | "REVISION_CONFLICT"
      | "STATE_CONFLICT"
      | "VALIDATION_ERROR",
  ) {
    super(code);
    this.name = "AccountDeletionServiceError";
  }
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1_000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function sameBuffer(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function providerSummary(states: readonly string[]): ProviderSummaryState {
  if (states.length === 0) return "not_started";
  if (states.some((state) => state === "failed" || state === "pending_escalation")) {
    return "escalated";
  }
  if (states.some((state) => state === "queued" || state === "requested")) return "pending";
  if (states.every((state) => state === "not_required")) return "not_required";
  return "confirmed";
}

function mapDeletion(
  row: AccountDeletionRow,
  providerStates: readonly string[],
): AccountDeletionView {
  return Object.freeze({
    graceEndsAt: row.grace_ends_at.toISOString(),
    id: row.id,
    irreversibleAt: row.irreversible_at?.toISOString() ?? null,
    livePurgeDueAt: row.live_purge_due_at?.toISOString() ?? null,
    livePurgedAt: row.live_purged_at?.toISOString() ?? null,
    providerState: providerSummary(providerStates),
    requestedAt: row.requested_at.toISOString(),
    revision: row.revision,
    state: row.state,
  });
}

class AccountDeletionService {
  private readonly cancelExports: ((accountId: string) => Promise<void>) | undefined;
  private readonly hmacKey: Buffer;
  private readonly now: () => Date;
  private readonly pool: Pool;

  constructor(options: Readonly<AccountDeletionServiceOptions>) {
    this.cancelExports = options.cancelExports;
    this.hmacKey = options.hmacKey;
    this.pool = options.pool;
    this.now = options.now ?? (() => new Date());
  }

  async request(accountId: string, idempotencyKey: string): Promise<AccountDeletionView> {
    if (!UUID.test(idempotencyKey)) throw new AccountDeletionServiceError("VALIDATION_ERROR");
    const requestHmac = Buffer.from(
      canonicalRequestHmac({
        hmacKey: this.hmacKey,
        operation: "account_delete",
        payload: { confirmation: "DELETE_MY_CASHMEMO_ACCOUNT" },
        schemaVersion: "account-deletion-v1",
      }),
      "hex",
    );
    const now = this.now();
    const graceEndsAt = new Date(now.getTime() + SEVEN_DAYS);
    const deletionId = randomUUID();
    const result = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const existing = await transaction.query<{
        readonly request_hmac: Buffer;
        readonly result_id: string | null;
        readonly state: string;
      }>(
        `SELECT request_hmac, result_id, state FROM idempotency_records
         WHERE user_id = $1 AND operation = 'account_delete' AND key = $2`,
        [accountId, idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        if (!sameBuffer(replay.request_hmac, requestHmac)) {
          throw new AccountDeletionServiceError("IDEMPOTENCY_CONFLICT");
        }
        if (replay.state !== "succeeded" || replay.result_id === null) {
          throw new AccountDeletionServiceError("OPERATION_IN_PROGRESS");
        }
        const found = await transaction.query<AccountDeletionRow>(
          "SELECT * FROM account_deletions WHERE user_id = $1 AND id = $2",
          [accountId, replay.result_id],
        );
        const row = found.rows[0];
        if (row === undefined) throw new AccountDeletionServiceError("ACCOUNT_DELETION_NOT_FOUND");
        return { created: false, row };
      }

      const current = await transaction.query<AccountDeletionRow>(
        `SELECT * FROM account_deletions
         WHERE user_id = $1 AND state NOT IN ('canceled', 'complete')
         ORDER BY requested_at DESC LIMIT 1`,
        [accountId],
      );
      if (current.rows[0] !== undefined) return { created: false, row: current.rows[0] };

      await transaction.query(
        `INSERT INTO idempotency_records
           (id, user_id, operation, key, request_hmac, state, expires_at)
         VALUES ($1, $2, 'account_delete', $3, $4, 'in_progress', now() + interval '35 days')`,
        [randomUUID(), accountId, idempotencyKey, requestHmac],
      );
      const inserted = await transaction.query<AccountDeletionRow>(
        `INSERT INTO account_deletions
           (id, user_id, state, requested_at, grace_ends_at, revision)
         VALUES ($1, $2, 'grace', $3, $4, 1)
         RETURNING *`,
        [deletionId, accountId, now, graceEndsAt],
      );
      await transaction.query(
        `UPDATE users SET status = 'deletion_grace', updated_at = $2, revision = revision + 1
         WHERE id = $1 AND status = 'active'`,
        [accountId, now],
      );
      await transaction.query(
        `UPDATE export_jobs SET state = 'canceled', updated_at = $2, revision = revision + 1
         WHERE user_id = $1 AND state IN ('queued', 'running', 'ready', 'failed')`,
        [accountId, now],
      );
      await transaction.query(
        `UPDATE idempotency_records
         SET state = 'succeeded', result_type = 'account_deletion', result_id = $1,
             result_revision = 1, response_code = 'accepted', updated_at = $2
         WHERE user_id = $3 AND operation = 'account_delete' AND key = $4`,
        [deletionId, now, accountId, idempotencyKey],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("ACCOUNT_DELETION_CREATE_FAILED");
      return { created: true, row };
    });
    if (result.created && this.cancelExports !== undefined) await this.cancelExports(accountId);
    return mapDeletion(result.row, []);
  }

  async status(accountId: string): Promise<AccountDeletionView> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<AccountDeletionRow>(
        `SELECT * FROM account_deletions WHERE user_id = $1
         ORDER BY requested_at DESC LIMIT 1`,
        [accountId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new AccountDeletionServiceError("ACCOUNT_DELETION_NOT_FOUND");
      const providers = await transaction.query<{ state: string }>(
        "SELECT state FROM provider_deletions WHERE user_id = $1 AND account_deletion_id = $2",
        [accountId, row.id],
      );
      return mapDeletion(
        row,
        providers.rows.map((provider) => provider.state),
      );
    });
  }

  async cancel(accountId: string, expectedRevision: string): Promise<AccountDeletionView> {
    const now = this.now();
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<AccountDeletionRow>(
        `UPDATE account_deletions
         SET state = 'canceled', revision = revision + 1
         WHERE user_id = $1 AND state = 'grace' AND grace_ends_at > $2 AND revision = $3
         RETURNING *`,
        [accountId, now, expectedRevision],
      );
      if (result.rows[0] === undefined) {
        const current = await transaction.query<AccountDeletionRow>(
          `SELECT * FROM account_deletions WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
          [accountId],
        );
        const row = current.rows[0];
        if (row === undefined) throw new AccountDeletionServiceError("ACCOUNT_DELETION_NOT_FOUND");
        if (row.revision !== expectedRevision) {
          throw new AccountDeletionServiceError("REVISION_CONFLICT");
        }
        throw new AccountDeletionServiceError("IRREVERSIBLE_DELETION");
      }
      await transaction.query(
        `UPDATE users SET status = 'active', updated_at = $2, revision = revision + 1
         WHERE id = $1 AND status = 'deletion_grace'`,
        [accountId, now],
      );
    });
    return this.status(accountId);
  }

  async beginIrreversible(accountId: string, now = this.now()): Promise<AccountDeletionView> {
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<AccountDeletionRow>(
        `UPDATE account_deletions
         SET state = 'purging', irreversible_at = $2,
             live_purge_due_at = grace_ends_at + interval '24 hours',
             revision = revision + 1
         WHERE user_id = $1 AND state = 'grace' AND grace_ends_at <= $2
         RETURNING *`,
        [accountId, now],
      );
      if (result.rows[0] === undefined) throw new AccountDeletionServiceError("STATE_CONFLICT");
      await transaction.query(
        `UPDATE users SET status = 'purging', updated_at = $2, revision = revision + 1
         WHERE id = $1 AND status = 'deletion_grace'`,
        [accountId, now],
      );
    });
    return this.status(accountId);
  }

  async retryFailed(accountId: string): Promise<AccountDeletionView> {
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query(
        `UPDATE account_deletions
         SET state = 'purging', failure_class = NULL, revision = revision + 1
         WHERE user_id = $1 AND state = 'failed' AND irreversible_at IS NOT NULL`,
        [accountId],
      );
      if ((result.rowCount ?? 0) === 0) throw new AccountDeletionServiceError("STATE_CONFLICT");
    });
    return this.status(accountId);
  }

  async markLivePurged(accountId: string, deletionId: string): Promise<AccountDeletionView> {
    const now = this.now();
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query(
        `UPDATE account_deletions
         SET state = 'live_purged', live_purged_at = $3, failure_class = NULL,
             revision = revision + 1
         WHERE user_id = $1 AND id = $2 AND state = 'purging'`,
        [accountId, deletionId, now],
      );
      if ((result.rowCount ?? 0) === 0) throw new AccountDeletionServiceError("STATE_CONFLICT");
    });
    return this.status(accountId);
  }

  async markFailed(accountId: string, deletionId: string): Promise<AccountDeletionView> {
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query(
        `UPDATE account_deletions
         SET state = 'failed', failure_class = 'availability', revision = revision + 1
         WHERE user_id = $1 AND id = $2 AND state = 'purging'`,
        [accountId, deletionId],
      );
      if ((result.rowCount ?? 0) === 0) throw new AccountDeletionServiceError("STATE_CONFLICT");
    });
    return this.status(accountId);
  }

  async journalAccessState(accountId: string): Promise<"active" | "suspended"> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<{ status: string }>(
        "SELECT status FROM users WHERE id = $1",
        [accountId],
      );
      const status = result.rows[0]?.status;
      return status === "deletion_grace" || status === "purging" || status === "purged"
        ? "suspended"
        : "active";
    });
  }
}

export {
  AccountDeletionService,
  AccountDeletionServiceError,
  SEVEN_DAYS,
  TWENTY_FOUR_HOURS,
  mapDeletion,
  providerSummary,
  type AccountDeletionServiceOptions,
  type AccountDeletionState,
  type AccountDeletionView,
  type ProviderSummaryState,
};
