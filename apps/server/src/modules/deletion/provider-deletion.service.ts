import { randomUUID } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

type ProviderDeletionScope = "ai" | "email" | "storage" | "stt";
type ProviderDeletionState =
  "confirmed" | "failed" | "not_required" | "pending_escalation" | "queued" | "requested";

interface ProviderDeletionView {
  readonly attempts: number;
  readonly confirmedAt: string | null;
  readonly nextCheckAt: string | null;
  readonly providerDecisionVersion: string;
  readonly requestedAt: string | null;
  readonly scope: ProviderDeletionScope;
  readonly state: ProviderDeletionState;
}

interface ProviderDeletionServiceOptions {
  readonly now?: () => Date;
  readonly pool: Pool;
}

interface ProviderDeletionRow extends QueryResultRow {
  readonly attempts: number;
  readonly confirmed_at: Date | null;
  readonly next_check_at: Date | null;
  readonly provider_decision_version: string;
  readonly requested_at: Date | null;
  readonly scope: ProviderDeletionScope;
  readonly state: ProviderDeletionState;
}

function mapProvider(row: ProviderDeletionRow): ProviderDeletionView {
  return Object.freeze({
    attempts: row.attempts,
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    nextCheckAt: row.next_check_at?.toISOString() ?? null,
    providerDecisionVersion: row.provider_decision_version,
    requestedAt: row.requested_at?.toISOString() ?? null,
    scope: row.scope,
    state: row.state,
  });
}

class ProviderDeletionService {
  private readonly now: () => Date;

  constructor(private readonly options: Readonly<ProviderDeletionServiceOptions>) {
    this.now = options.now ?? (() => new Date());
  }

  async initialize(
    accountId: string,
    accountDeletionId: string,
    decisions: Readonly<
      Record<
        ProviderDeletionScope,
        { readonly decisionVersion: string; readonly required: boolean }
      >
    >,
  ): Promise<readonly ProviderDeletionView[]> {
    await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      for (const scope of ["ai", "email", "storage", "stt"] as const) {
        const decision = decisions[scope];
        await transaction.query(
          `INSERT INTO provider_deletions
             (id, user_id, account_deletion_id, provider_decision_version, scope, state, attempts)
           VALUES ($1, $2, $3, $4, $5, $6, 0)
           ON CONFLICT (account_deletion_id, scope) DO NOTHING`,
          [
            randomUUID(),
            accountId,
            accountDeletionId,
            decision.decisionVersion,
            scope,
            decision.required ? "queued" : "not_required",
          ],
        );
      }
    });
    return this.list(accountId, accountDeletionId);
  }

  async markRequested(
    accountId: string,
    accountDeletionId: string,
    scope: ProviderDeletionScope,
  ): Promise<ProviderDeletionView> {
    return this.transition(accountId, accountDeletionId, scope, "requested");
  }

  async markConfirmed(
    accountId: string,
    accountDeletionId: string,
    scope: ProviderDeletionScope,
  ): Promise<ProviderDeletionView> {
    return this.transition(accountId, accountDeletionId, scope, "confirmed");
  }

  async markFailed(
    accountId: string,
    accountDeletionId: string,
    scope: ProviderDeletionScope,
    escalationRequired: boolean,
  ): Promise<ProviderDeletionView> {
    return this.transition(
      accountId,
      accountDeletionId,
      scope,
      escalationRequired ? "pending_escalation" : "failed",
    );
  }

  async list(
    accountId: string,
    accountDeletionId: string,
  ): Promise<readonly ProviderDeletionView[]> {
    return withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const result = await transaction.query<ProviderDeletionRow>(
        `SELECT * FROM provider_deletions
         WHERE user_id = $1 AND account_deletion_id = $2
         ORDER BY CASE scope WHEN 'stt' THEN 1 WHEN 'ai' THEN 2
                             WHEN 'email' THEN 3 WHEN 'storage' THEN 4 END`,
        [accountId, accountDeletionId],
      );
      return result.rows.map(mapProvider);
    });
  }

  async reconcileAccountState(accountId: string, accountDeletionId: string): Promise<string> {
    const providers = await this.list(accountId, accountDeletionId);
    return withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const current = await transaction.query<{ state: string }>(
        `SELECT state FROM account_deletions WHERE user_id = $1 AND id = $2`,
        [accountId, accountDeletionId],
      );
      if (
        current.rows[0]?.state !== "live_purged" &&
        current.rows[0]?.state !== "provider_pending"
      ) {
        throw new Error("LIVE_PURGE_NOT_COMPLETE");
      }
      const hasFailure = providers.some(
        (provider) => provider.state === "failed" || provider.state === "pending_escalation",
      );
      const hasPending = providers.some(
        (provider) => provider.state === "queued" || provider.state === "requested",
      );
      const state = hasFailure || hasPending ? "provider_pending" : "complete";
      await transaction.query(
        `UPDATE account_deletions
         SET state = $3::account_deletion_state,
             completed_at = CASE WHEN $3::text = 'complete' THEN $4::timestamptz
                                 ELSE NULL::timestamptz END,
             revision = revision + 1
         WHERE user_id = $1 AND id = $2 AND state IN ('live_purged', 'provider_pending')`,
        [accountId, accountDeletionId, state, this.now()],
      );
      return state;
    });
  }

  private async transition(
    accountId: string,
    accountDeletionId: string,
    scope: ProviderDeletionScope,
    state: "confirmed" | "failed" | "pending_escalation" | "requested",
  ): Promise<ProviderDeletionView> {
    const now = this.now();
    return withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const result = await transaction.query<ProviderDeletionRow>(
        `UPDATE provider_deletions
         SET state = $4::provider_deletion_state,
             requested_at = CASE WHEN $4::text = 'requested' THEN $5 ELSE requested_at END,
             confirmed_at = CASE WHEN $4::text = 'confirmed' THEN $5 ELSE NULL END,
             next_check_at = CASE WHEN $4::text IN ('failed', 'pending_escalation')
                                  THEN $5 + interval '1 hour' ELSE NULL END,
             attempts = attempts + 1,
             failure_class = CASE WHEN $4::text IN ('failed', 'pending_escalation')
                                  THEN 'provider'::operation_failure_class
                                  ELSE NULL::operation_failure_class END
         WHERE user_id = $1 AND account_deletion_id = $2 AND scope = $3
           AND state <> 'not_required'
         RETURNING *`,
        [accountId, accountDeletionId, scope, state, now],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("PROVIDER_DELETION_STATE_CONFLICT");
      return mapProvider(row);
    });
  }
}

export {
  ProviderDeletionService,
  mapProvider,
  type ProviderDeletionScope,
  type ProviderDeletionServiceOptions,
  type ProviderDeletionState,
  type ProviderDeletionView,
};
