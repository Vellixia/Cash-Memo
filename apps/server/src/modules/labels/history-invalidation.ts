import type { AccountTransaction } from "../../adapters/postgres/transaction-context.js";

/** Label mutations and traversal invalidation share the caller's transaction. */
export async function invalidateHistoryForLabelMutation(
  transaction: AccountTransaction,
): Promise<void> {
  await transaction.query(
    `INSERT INTO history_list_states (user_id, version, updated_at)
     VALUES ($1, 1, now())
     ON CONFLICT (user_id) DO UPDATE
       SET version = history_list_states.version + 1, updated_at = now()`,
    [transaction.authenticatedAccountId],
  );
}
