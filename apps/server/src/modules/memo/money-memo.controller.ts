import { canonicalRequestHmac } from "@cashmemo/domain";

import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import {
  createMoneyMemo,
  updateMoneyMemo,
  getMoneyMemo,
  archiveMoneyMemo,
  restoreArchivedMoneyMemo,
  moveToRecentlyDeleted,
  restoreRecentlyDeleted,
  initiatePurge,
  MoneyMemoServiceError,
  type MoneyMemoInput,
  type MoneyMemoView,
} from "./money-memo.service.js";

export interface MoneyMemoControllerOptions {
  pool: Pool;
  hmacKey: Uint8Array;
}

export function createMoneyMemoController(options: Readonly<MoneyMemoControllerOptions>) {
  const { pool, hmacKey } = options;

  return {
    async confirmManualMemo(
      accountId: string,
      idempotencyKey: string,
      input: Readonly<MoneyMemoInput>,
    ): Promise<{ status: number; body: MoneyMemoView | { messageCode: string } }> {
      const requestHmac = canonicalRequestHmac({
        hmacKey,
        operation: "memo_create",
        payload: input,
        schemaVersion: "memo-create-v1",
      });
      try {
        const memo = await withAccountTransaction(pool, accountId, async (tx) => {
          return createMoneyMemo(tx, input, idempotencyKey, Buffer.from(requestHmac, "hex"));
        });
        return { status: 201, body: memo };
      } catch (error) {
        if (error instanceof MoneyMemoServiceError) {
          if (error.code === "OPERATION_IN_PROGRESS") {
            return { status: 409, body: { messageCode: "OPERATION_IN_PROGRESS" } };
          }
        }
        throw error;
      }
    },

    async getMemo(accountId: string, memoId: string): Promise<MoneyMemoView> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        return getMoneyMemo(tx, memoId);
      });
    },

    async updateMemo(
      accountId: string,
      memoId: string,
      input: Readonly<MoneyMemoInput>,
      expectedRevision: string,
    ): Promise<MoneyMemoView> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        return updateMoneyMemo(tx, memoId, input, expectedRevision);
      });
    },

    async archiveMemo(
      accountId: string,
      memoId: string,
      expectedRevision: string,
    ): Promise<MoneyMemoView> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        return archiveMoneyMemo(tx, memoId, expectedRevision);
      });
    },

    async restoreArchivedMemo(
      accountId: string,
      memoId: string,
      expectedRevision: string,
    ): Promise<MoneyMemoView> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        return restoreArchivedMoneyMemo(tx, memoId, expectedRevision);
      });
    },

    async moveToRecentlyDeleted(
      accountId: string,
      memoId: string,
      expectedRevision: string,
    ): Promise<MoneyMemoView> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        return moveToRecentlyDeleted(tx, memoId, expectedRevision);
      });
    },

    async restoreRecentlyDeleted(
      accountId: string,
      memoId: string,
      expectedRevision: string,
    ): Promise<MoneyMemoView> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        return restoreRecentlyDeleted(tx, memoId, expectedRevision);
      });
    },

    async initiatePurge(
      accountId: string,
      memoId: string,
      expectedRevision: string,
    ): Promise<MoneyMemoView> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        return initiatePurge(tx, memoId, expectedRevision);
      });
    },

    async listMemos(
      accountId: string,
      limit: number,
      lifecycle: "active" | "archived" | "all_non_deleted",
    ): Promise<{ items: MoneyMemoView[]; resultSetVersion: string; nextCursor: string | null }> {
      return withAccountTransaction(pool, accountId, async (tx) => {
        const lifecycleFilter =
          lifecycle === "all_non_deleted" ? `IN ('active', 'archived')` : `= '${lifecycle}'`;

        const versionResult = await tx.query<{ version: string }>(
          `SELECT version::text FROM history_list_states WHERE user_id = $1`,
          [accountId],
        );
        const resultSetVersion = versionResult.rows[0]?.version ?? "1";

        const result = await tx.query<Record<string, unknown>>(
          `SELECT * FROM money_memos
            WHERE user_id = $1 AND lifecycle_state ${lifecycleFilter}
            ORDER BY occurred_at DESC, id DESC
            LIMIT $2`,
          [accountId, limit + 1],
        );

        const items = result.rows.slice(0, limit).map(mapRow);
        const hasMore = result.rows.length > limit;
        const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

        return { items, resultSetVersion, nextCursor };
      });
    },
  };
}

function mapRow(row: Record<string, unknown>): MoneyMemoView {
  return {
    categoryId: row["category_id"] as string | null,
    createdAt: row["created_at"] as string,
    direction: row["direction"] as "income" | "expense",
    id: row["id"] as string,
    lifecycleState: row["lifecycle_state"] as "active" | "archived",
    money: {
      amount: "0",
      amountMinor: row["amount_minor"] as string,
      currency: row["currency_code"] as string,
      currencyExponent: row["currency_exponent"] as number,
      currencyRegistryVersion: row["currency_registry_version"] as string,
    },
    moneySpaceId: row["money_space_id"] as string | null,
    note: row["note"] as string | null,
    occurrence: {
      occurredAt: row["occurred_at"] as string,
      occurredLocal: row["occurred_local"] as string,
      occurredOffsetMinutes: row["occurred_offset_minutes"] as number,
      occurredTimezone: row["occurred_timezone"] as string,
      timezoneDatabaseVersion: row["timezone_database_version"] as string,
    },
    origin: "manual",
    planningStatus: row["planning_status"] as "planned" | "unplanned" | null,
    purpose: row["purpose"] as "personal" | "work" | "mixed" | null,
    revision: String(row["revision"]),
    updatedAt: row["updated_at"] as string,
  };
}
