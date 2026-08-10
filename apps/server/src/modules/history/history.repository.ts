import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

export interface HistoryPage {
  readonly items: readonly HistoryItem[];
  readonly nextCursor: string | null;
  readonly resultSetVersion: string;
}

export interface HistoryItem {
  readonly id: string;
  readonly direction: "income" | "expense";
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly occurredAt: string;
  readonly lifecycleState: string;
  readonly revision: string;
}

export interface HistoryQueryOptions {
  readonly limit: number;
  readonly lifecycle: "active" | "archived" | "all_non_deleted";
}

export async function queryFirstPage(
  pool: Pool,
  accountId: string,
  options: Readonly<HistoryQueryOptions>,
): Promise<HistoryPage> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const versionResult = await tx.query<{ version: string }>(
      `SELECT version::text FROM history_list_states WHERE user_id = $1`,
      [accountId],
    );
    const resultSetVersion = versionResult.rows[0]?.version ?? "1";

    const lifecycleFilter =
      options.lifecycle === "all_non_deleted"
        ? `IN ('active', 'archived')`
        : `= '${options.lifecycle}'`;

    const result = await tx.query<Record<string, unknown>>(
      `SELECT id, direction, amount_minor::text, currency_code, occurred_at, lifecycle_state, revision::text
       FROM money_memos
       WHERE user_id = $1 AND lifecycle_state ${lifecycleFilter}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $2`,
      [accountId, options.limit + 1],
    );

    const items: HistoryItem[] = result.rows.slice(0, options.limit).map((row) => ({
      amountMinor: row["amount_minor"] as string,
      currencyCode: row["currency_code"] as string,
      direction: row["direction"] as "income" | "expense",
      id: row["id"] as string,
      lifecycleState: row["lifecycle_state"] as string,
      occurredAt: row["occurred_at"] as string,
      revision: row["revision"] as string,
    }));

    const hasMore = result.rows.length > options.limit;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { items, nextCursor, resultSetVersion };
  });
}
