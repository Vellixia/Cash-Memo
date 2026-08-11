import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import { decodeCursor, encodeCursor, type CursorCodecOptions } from "./cursor-codec.js";
import { computeQueryFingerprint, type TraversalQuery } from "./query-fingerprint.js";
import { getHistoryListVersion } from "./history-list-state.repository.js";

export interface TraversalPage {
  readonly items: readonly TraversalItem[];
  readonly nextCursor: string | null;
  readonly resultSetVersion: number;
}

export interface TraversalItem {
  readonly id: string;
  readonly direction: "income" | "expense";
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly occurredAt: string;
  readonly lifecycleState: string;
  readonly revision: string;
}

export class TraversalError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TraversalError";
  }
}

export interface VersionedTraversalOptions {
  readonly pool: Pool;
  readonly cursorCodec: CursorCodecOptions;
}

export async function queryFirstPage(
  pool: Pool,
  accountId: string,
  query: Readonly<TraversalQuery>,
  limit: number,
  options: Readonly<VersionedTraversalOptions>,
): Promise<TraversalPage> {
  const fingerprint = computeQueryFingerprint(query);
  const version = await getHistoryListVersion(pool, accountId);

  return withAccountTransaction(pool, accountId, async (tx) => {
    const lifecycleFilter = buildLifecycleFilter(query.lifecycle);
    const result = await tx.query(
      `SELECT id, direction, amount_minor::text, currency_code, occurred_at, lifecycle_state, revision::text
       FROM money_memos
       WHERE user_id = $1 AND lifecycle_state ${lifecycleFilter}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $2`,
      [accountId, limit + 1],
    );

    const items: TraversalItem[] = result.rows
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        amountMinor: row["amount_minor"] as string,
        currencyCode: row["currency_code"] as string,
        direction: row["direction"] as "income" | "expense",
        id: row["id"] as string,
        lifecycleState: row["lifecycle_state"] as string,
        occurredAt: row["occurred_at"] as string,
        revision: row["revision"] as string,
      }));

    const hasMore = result.rows.length > limit;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeCursor(
            {
              cursorFormatVersion: 1,
              lastId: items[items.length - 1]?.id ?? "",
              lastOccurredAt: items[items.length - 1]?.occurredAt ?? "",
              queryFingerprint: fingerprint,
              version,
            },
            options.cursorCodec,
          )
        : null;

    return { items, nextCursor, resultSetVersion: version };
  });
}

export async function queryContinuation(
  pool: Pool,
  accountId: string,
  query: Readonly<TraversalQuery>,
  cursor: string,
  limit: number,
  options: Readonly<VersionedTraversalOptions>,
): Promise<TraversalPage> {
  const decoded = decodeCursor(cursor, options.cursorCodec);
  const currentFingerprint = computeQueryFingerprint(query);

  if (decoded.queryFingerprint !== currentFingerprint) {
    throw new TraversalError("RESULTS_CHANGED");
  }

  const currentVersion = await getHistoryListVersion(pool, accountId);
  if (decoded.version !== currentVersion) {
    throw new TraversalError("RESULTS_CHANGED");
  }

  return withAccountTransaction(pool, accountId, async (tx) => {
    const lifecycleFilter = buildLifecycleFilter(query.lifecycle);
    const result = await tx.query(
      `SELECT id, direction, amount_minor::text, currency_code, occurred_at, lifecycle_state, revision::text
       FROM money_memos
       WHERE user_id = $1 AND lifecycle_state ${lifecycleFilter}
         AND (occurred_at, id) < ($2, $3)
       ORDER BY occurred_at DESC, id DESC
       LIMIT $4`,
      [accountId, decoded.lastOccurredAt, decoded.lastId, limit + 1],
    );

    const items: TraversalItem[] = result.rows
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        amountMinor: row["amount_minor"] as string,
        currencyCode: row["currency_code"] as string,
        direction: row["direction"] as "income" | "expense",
        id: row["id"] as string,
        lifecycleState: row["lifecycle_state"] as string,
        occurredAt: row["occurred_at"] as string,
        revision: row["revision"] as string,
      }));

    const hasMore = result.rows.length > limit;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeCursor(
            {
              cursorFormatVersion: 1,
              lastId: items[items.length - 1]?.id ?? "",
              lastOccurredAt: items[items.length - 1]?.occurredAt ?? "",
              queryFingerprint: currentFingerprint,
              version: currentVersion,
            },
            options.cursorCodec,
          )
        : null;

    return { items, nextCursor, resultSetVersion: currentVersion };
  });
}

function buildLifecycleFilter(lifecycle: TraversalQuery["lifecycle"]): string {
  if (lifecycle === "all_non_deleted") return `IN ('active', 'archived')`;
  return `= '${lifecycle}'`;
}
