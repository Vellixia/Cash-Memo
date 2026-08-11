import { createHmac } from "node:crypto";

import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import {
  createSuppressionRecord,
  type DeletionSuppressionPort,
} from "./deletion-suppression.port.js";

interface AccountPurgeWorkerOptions {
  readonly auditHmacKey: Buffer;
  readonly deleteExports: (accountId: string) => Promise<void>;
  readonly identityPool: Pool;
  readonly policyVersion: string;
  readonly pool: Pool;
  readonly suppressionKey: Buffer;
  readonly suppressionKeyVersion: string;
  readonly suppressionPort: DeletionSuppressionPort;
}

interface AccountPurgeResult {
  readonly hardDeletedContent: boolean;
  readonly state: "live_purged" | "purge_failed" | "suppression_pending";
  readonly suppressionDurable: boolean;
}

class AccountPurgeWorker {
  constructor(private readonly options: Readonly<AccountPurgeWorkerOptions>) {}

  async purge(accountId: string, deletionId: string): Promise<AccountPurgeResult> {
    const deletion = await withAccountTransaction(
      this.options.pool,
      accountId,
      async (transaction) => {
        const result = await transaction.query<{
          readonly irreversible_at: Date | null;
          readonly state: string;
        }>(
          `SELECT state, irreversible_at FROM account_deletions
           WHERE user_id = $1 AND id = $2`,
          [accountId, deletionId],
        );
        return result.rows[0] ?? null;
      },
    );
    if (deletion?.state !== "purging" || deletion.irreversible_at === null) {
      throw new Error("ACCOUNT_NOT_IN_PURGING_STATE");
    }
    const record = createSuppressionRecord({
      entityId: accountId,
      entityType: "account",
      policyVersion: this.options.policyVersion,
      purgedAt: deletion.irreversible_at,
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
          hardDeletedContent: false,
          state: "suppression_pending",
          suppressionDurable: false,
        });
      }
    } catch {
      return Object.freeze({
        hardDeletedContent: false,
        state: "suppression_pending",
        suppressionDurable: false,
      });
    }

    try {
      await this.options.deleteExports(accountId);
      await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
        await transaction.query("DELETE FROM reauth_grants WHERE user_id = $1", [accountId]);
      });
      const identity = await this.options.identityPool.connect();
      try {
        await identity.query("BEGIN");
        await identity.query("DELETE FROM sessions WHERE user_id = $1", [accountId]);
        await identity.query("DELETE FROM credential_accounts WHERE user_id = $1", [accountId]);
        await identity.query("COMMIT");
      } catch (error) {
        await identity.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        identity.release();
      }

      await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
        await transaction.query("DELETE FROM temporary_audio_metadata WHERE user_id = $1", [
          accountId,
        ]);
        await transaction.query("DELETE FROM provider_attempts WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM assisted_captures WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM compose_drafts WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM money_memos WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM categories WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM money_spaces WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM history_list_states WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM preferences WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM profiles WHERE user_id = $1", [accountId]);
        await transaction.query("DELETE FROM idempotency_records WHERE user_id = $1", [accountId]);
        const anonymizedEmail = `${createHmac("sha256", this.options.auditHmacKey)
          .update(`deleted-account:${accountId}`, "utf8")
          .digest("hex")}@deleted.invalid`;
        await transaction.query(
          `UPDATE users SET status = 'purged', email = $2, updated_at = now(), revision = revision + 1
           WHERE id = $1 AND status = 'purging'`,
          [accountId, anonymizedEmail],
        );
        await transaction.query(
          `UPDATE account_deletions
           SET state = 'live_purged', live_purged_at = now(), failure_class = NULL,
               revision = revision + 1
           WHERE user_id = $1 AND id = $2 AND state = 'purging'`,
          [accountId, deletionId],
        );
      });
      return Object.freeze({
        hardDeletedContent: true,
        state: "live_purged",
        suppressionDurable: true,
      });
    } catch {
      await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
        await transaction.query(
          `UPDATE account_deletions SET state = 'failed', failure_class = 'availability',
                  revision = revision + 1
           WHERE user_id = $1 AND id = $2 AND state = 'purging'`,
          [accountId, deletionId],
        );
      }).catch(() => undefined);
      return Object.freeze({
        hardDeletedContent: false,
        state: "purge_failed",
        suppressionDurable: true,
      });
    }
  }
}

export { AccountPurgeWorker, type AccountPurgeResult, type AccountPurgeWorkerOptions };
