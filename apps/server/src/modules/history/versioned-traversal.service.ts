import { createHash } from "node:crypto";

import type { Pool } from "pg";

import {
  type AccountTransaction,
  withAccountTransaction,
} from "../../adapters/postgres/transaction-context.js";
import { decodeCursor, encodeCursor, type CursorCodecOptions } from "./cursor-codec.js";
import { computeQueryFingerprint, type TraversalQuery } from "./query-fingerprint.js";

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
  readonly categoryId: string | null;
  readonly moneySpaceId: string | null;
  readonly note: string | null;
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
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

function accountBoundFingerprint(accountId: string, query: Readonly<TraversalQuery>): string {
  return createHash("sha256")
    .update(accountId)
    .update(":")
    .update(computeQueryFingerprint(query))
    .digest("hex");
}

async function currentVersion(transaction: AccountTransaction): Promise<number> {
  const result = await transaction.query<{ version: string }>(
    `SELECT version::text FROM history_list_states WHERE user_id = $1`,
    [transaction.authenticatedAccountId],
  );
  const row = result.rows[0];
  if (row !== undefined) return Number(row.version);
  await transaction.query(
    `INSERT INTO history_list_states (user_id, version, updated_at)
     VALUES ($1, 1, now()) ON CONFLICT DO NOTHING`,
    [transaction.authenticatedAccountId],
  );
  return 1;
}

function arrayPredicate(
  column: string,
  cast: string,
  values: readonly string[],
  parameters: unknown[],
  predicates: string[],
): void {
  if (values.length === 0) return;
  parameters.push(values);
  predicates.push(`${column} = ANY($${String(parameters.length)}::${cast}[])`);
}

function nullableEnumPredicate(
  column: string,
  cast: string,
  values: readonly string[],
  parameters: unknown[],
  predicates: string[],
): void {
  if (values.length === 0) return;
  const includesNull = values.includes("unspecified");
  const concrete = values.filter((value) => value !== "unspecified");
  if (concrete.length > 0) {
    parameters.push(concrete);
    const any = `${column} = ANY($${String(parameters.length)}::${cast}[])`;
    predicates.push(includesNull ? `(${any} OR ${column} IS NULL)` : any);
  } else {
    predicates.push(`${column} IS NULL`);
  }
}

async function loadItems(
  transaction: AccountTransaction,
  query: Readonly<TraversalQuery>,
  limit: number,
  after: { readonly id: string; readonly occurredAt: string } | null,
): Promise<readonly TraversalItem[]> {
  const parameters: unknown[] = [transaction.authenticatedAccountId];
  const predicates = ["user_id = $1"];
  if (query.lifecycle === "all_non_deleted") {
    predicates.push("lifecycle_state IN ('active', 'archived')");
  } else {
    parameters.push(query.lifecycle);
    predicates.push(`lifecycle_state = $${String(parameters.length)}::memo_lifecycle_state`);
  }

  if (query.from !== null) {
    parameters.push(query.from);
    predicates.push(`occurred_at >= $${String(parameters.length)}::timestamptz`);
  }
  if (query.to !== null) {
    parameters.push(query.to);
    predicates.push(`occurred_at < $${String(parameters.length)}::timestamptz`);
  }
  arrayPredicate("direction", "memo_direction", query.directions, parameters, predicates);
  arrayPredicate("category_id", "uuid", query.categoryIds, parameters, predicates);
  arrayPredicate("money_space_id", "uuid", query.moneySpaceIds, parameters, predicates);
  arrayPredicate("currency_code", "text", query.currencies, parameters, predicates);
  nullableEnumPredicate("purpose", "memo_purpose", query.purposes, parameters, predicates);
  nullableEnumPredicate(
    "planning_status",
    "planning_status",
    query.planningStatuses,
    parameters,
    predicates,
  );
  if (query.searchQuery !== null) {
    parameters.push(query.searchQuery);
    predicates.push(`search_vector @@ plainto_tsquery('simple', $${String(parameters.length)})`);
  }
  if (after !== null) {
    parameters.push(after.occurredAt, after.id);
    predicates.push(
      `(occurred_at, id) < ($${String(parameters.length - 1)}::timestamptz, $${String(parameters.length)}::uuid)`,
    );
  }
  parameters.push(limit + 1);
  const result = await transaction.query<Record<string, unknown>>(
    `SELECT id, direction, amount_minor::text, currency_code, occurred_at, lifecycle_state,
            revision::text, category_id, money_space_id, purpose, planning_status, note
       FROM money_memos
      WHERE ${predicates.join(" AND ")}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${String(parameters.length)}`,
    parameters,
  );
  return result.rows.map((row) => ({
    amountMinor: row["amount_minor"] as string,
    categoryId: row["category_id"] as string | null,
    currencyCode: row["currency_code"] as string,
    direction: row["direction"] as "income" | "expense",
    id: row["id"] as string,
    lifecycleState: row["lifecycle_state"] as string,
    moneySpaceId: row["money_space_id"] as string | null,
    note: row["note"] as string | null,
    occurredAt: new Date(row["occurred_at"] as string | Date).toISOString(),
    planningStatus: row["planning_status"] as "planned" | "unplanned" | null,
    purpose: row["purpose"] as "mixed" | "personal" | "work" | null,
    revision: row["revision"] as string,
  }));
}

function pageFromItems(
  itemsWithSentinel: readonly TraversalItem[],
  limit: number,
  version: number,
  fingerprint: string,
  cursorCodec: CursorCodecOptions,
): TraversalPage {
  const items = itemsWithSentinel.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    itemsWithSentinel.length > limit && last !== undefined
      ? encodeCursor(
          {
            cursorFormatVersion: 1,
            lastId: last.id,
            lastOccurredAt: last.occurredAt,
            queryFingerprint: fingerprint,
            version,
          },
          cursorCodec,
        )
      : null;
  return { items, nextCursor, resultSetVersion: version };
}

export async function queryFirstPage(
  pool: Pool,
  accountId: string,
  query: Readonly<TraversalQuery>,
  limit: number,
  options: Readonly<VersionedTraversalOptions>,
): Promise<TraversalPage> {
  const fingerprint = accountBoundFingerprint(accountId, query);
  return withAccountTransaction(pool, accountId, async (transaction) => {
    const version = await currentVersion(transaction);
    const items = await loadItems(transaction, query, limit, null);
    return pageFromItems(items, limit, version, fingerprint, options.cursorCodec);
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
  const fingerprint = accountBoundFingerprint(accountId, query);
  if (decoded.queryFingerprint !== fingerprint) throw new TraversalError("RESULTS_CHANGED");

  return withAccountTransaction(pool, accountId, async (transaction) => {
    const version = await currentVersion(transaction);
    if (decoded.version !== version) throw new TraversalError("RESULTS_CHANGED");
    const items = await loadItems(transaction, query, limit, {
      id: decoded.lastId,
      occurredAt: decoded.lastOccurredAt,
    });
    return pageFromItems(items, limit, version, fingerprint, options.cursorCodec);
  });
}
