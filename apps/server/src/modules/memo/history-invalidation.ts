import type { AccountTransaction } from "../../adapters/postgres/transaction-context.js";
import { incrementHistoryListVersionInTransaction } from "../history/application/ports/history-invalidation.port.js";

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
