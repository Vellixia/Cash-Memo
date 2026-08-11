import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

interface TransactionLike {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function getHistoryListVersion(pool: Pool, accountId: string): Promise<number> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const result = await tx.query<{ version: string }>(
      `SELECT version::text FROM history_list_states WHERE user_id = $1`,
      [accountId],
    );
    if (result.rowCount === 0) {
      await tx.query(
        `INSERT INTO history_list_states (user_id, version, updated_at) VALUES ($1, 1, now()) ON CONFLICT DO NOTHING`,
        [accountId],
      );
      return 1;
    }
    const row = result.rows[0];
    return Number(row?.version ?? "1");
  });
}

export async function incrementHistoryListVersion(pool: Pool, accountId: string): Promise<void> {
  await withAccountTransaction(pool, accountId, async (tx) => {
    await tx.query(
      `INSERT INTO history_list_states (user_id, version, updated_at)
       VALUES ($1, 1, now())
       ON CONFLICT (user_id) DO UPDATE SET version = history_list_states.version + 1, updated_at = now()`,
      [accountId],
    );
  });
}

export async function incrementHistoryListVersionInTransaction(
  tx: TransactionLike,
  accountId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO history_list_states (user_id, version, updated_at)
     VALUES ($1, 1, now())
     ON CONFLICT (user_id) DO UPDATE SET version = history_list_states.version + 1, updated_at = now()`,
    [accountId],
  );
}
