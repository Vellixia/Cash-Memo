import { createHmac } from "node:crypto";

import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import {
  createSuppressionRecord,
  type DeletionSuppressionPort,
} from "./deletion-suppression.port.js";

interface MemoPurgeWorkerOptions {
  readonly afterSuppressionVerified?: () => Promise<void>;
  readonly auditHmacKey: Buffer;
  readonly policyVersion: string;
  readonly pool: Pool;
  readonly suppressionKey: Buffer;
  readonly suppressionKeyVersion: string;
  readonly suppressionPort: DeletionSuppressionPort;
}

interface MemoPurgeResult {
  readonly hardDeleted: boolean;
  readonly state: "already_absent" | "purged" | "suppression_pending";
  readonly suppressionDurable: boolean;
}

class MemoPurgeWorker {
  constructor(private readonly options: Readonly<MemoPurgeWorkerOptions>) {}

  async purge(accountId: string, memoId: string): Promise<MemoPurgeResult> {
    const memo = await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const result = await transaction.query<{
        readonly id: string;
        readonly lifecycle_state: string;
        readonly updated_at: Date;
      }>(
        `SELECT id, lifecycle_state, updated_at FROM money_memos
         WHERE user_id = $1 AND id = $2`,
        [accountId, memoId],
      );
      return result.rows[0] ?? null;
    });
    if (memo === null) {
      return Object.freeze({
        hardDeleted: false,
        state: "already_absent",
        suppressionDurable: true,
      });
    }
    if (memo.lifecycle_state !== "purging") throw new Error("MEMO_NOT_IN_PURGING_STATE");

    const record = createSuppressionRecord({
      entityId: memo.id,
      entityType: "money_memo",
      policyVersion: this.options.policyVersion,
      purgedAt: memo.updated_at,
      suppressionKey: this.options.suppressionKey,
      suppressionKeyVersion: this.options.suppressionKeyVersion,
    });
    try {
      await this.options.suppressionPort.ensureDurable(record);
      const verified = await this.options.suppressionPort.verifyDurable(
        record.deletionToken,
        record.suppressionKeyVersion,
      );
      if (verified === null) {
        return Object.freeze({
          hardDeleted: false,
          state: "suppression_pending",
          suppressionDurable: false,
        });
      }
    } catch {
      return Object.freeze({
        hardDeleted: false,
        state: "suppression_pending",
        suppressionDurable: false,
      });
    }

    await this.options.afterSuppressionVerified?.();

    const deleted = await withAccountTransaction(
      this.options.pool,
      accountId,
      async (transaction) => {
        const result = await transaction.query(
          `DELETE FROM money_memos
           WHERE user_id = $1 AND id = $2 AND lifecycle_state = 'purging'`,
          [accountId, memoId],
        );
        if ((result.rowCount ?? 0) > 0) {
          await transaction.query(
            `UPDATE history_list_states
             SET version = version + 1, updated_at = now() WHERE user_id = $1`,
            [accountId],
          );
          const subjectHmac = createHmac("sha256", this.options.auditHmacKey)
            .update(`money_memo:${memoId}`, "utf8")
            .digest();
          const actorHmac = createHmac("sha256", this.options.auditHmacKey)
            .update("system:memo-purge-worker", "utf8")
            .digest();
          await transaction.query(
            `INSERT INTO content_free_mutation_audits
               (id, subject_hmac, actor_session_hmac, operation, result, occurred_at, expires_at)
             VALUES (gen_random_uuid(), $1, $2, 'memo_purged', 'succeeded', now(), now() + interval '35 days')`,
            [subjectHmac, actorHmac],
          );
        }
        return (result.rowCount ?? 0) > 0;
      },
    );
    return Object.freeze({
      hardDeleted: deleted,
      state: deleted ? "purged" : "already_absent",
      suppressionDurable: true,
    });
  }
}

export { MemoPurgeWorker, type MemoPurgeResult, type MemoPurgeWorkerOptions };
