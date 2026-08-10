import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import {
  archiveMoneyMemo,
  restoreArchivedMoneyMemo,
  moveToRecentlyDeleted,
  restoreRecentlyDeleted,
  initiatePurge,
  type MoneyMemoView,
} from "../memo/money-memo.service.js";

export async function archiveMemo(
  pool: Pool,
  accountId: string,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const memo = await archiveMoneyMemo(tx, memoId, expectedRevision);
    await tx.query(
      `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
      [accountId],
    );
    return memo;
  });
}

export async function restoreArchivedMemo(
  pool: Pool,
  accountId: string,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const memo = await restoreArchivedMoneyMemo(tx, memoId, expectedRevision);
    await tx.query(
      `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
      [accountId],
    );
    return memo;
  });
}

export async function deleteMemo(
  pool: Pool,
  accountId: string,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const memo = await moveToRecentlyDeleted(tx, memoId, expectedRevision);
    await tx.query(
      `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
      [accountId],
    );
    return memo;
  });
}

export async function restoreDeletedMemo(
  pool: Pool,
  accountId: string,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const memo = await restoreRecentlyDeleted(tx, memoId, expectedRevision);
    await tx.query(
      `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
      [accountId],
    );
    return memo;
  });
}

export async function requestPurge(
  pool: Pool,
  accountId: string,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    return initiatePurge(tx, memoId, expectedRevision);
  });
}
