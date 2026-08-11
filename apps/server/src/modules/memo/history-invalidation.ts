import type { AccountTransaction } from "../../adapters/postgres/transaction-context.js";
import { incrementHistoryListVersionInTransaction } from "../history/history-list-state.repository.js";

export async function invalidateHistoryOnCreate(
  tx: AccountTransaction,
  accountId: string,
): Promise<void> {
  await incrementHistoryListVersionInTransaction(tx, accountId);
}

export async function invalidateHistoryOnEdit(
  tx: AccountTransaction,
  accountId: string,
): Promise<void> {
  await incrementHistoryListVersionInTransaction(tx, accountId);
}

export async function invalidateHistoryOnLifecycleChange(
  tx: AccountTransaction,
  accountId: string,
): Promise<void> {
  await incrementHistoryListVersionInTransaction(tx, accountId);
}
