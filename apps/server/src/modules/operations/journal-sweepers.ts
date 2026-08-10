import type { Pool } from "pg";

export async function sweepExpiredDrafts(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE compose_drafts SET status = 'failed_recoverable'
     WHERE expires_at < now() AND status IN ('editing', 'reviewable', 'processing')`,
  );
  return result.rowCount ?? 0;
}

export async function sweepRecentlyDeletedDue(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE money_memos SET lifecycle_state = 'purging', updated_at = now(), revision = revision + 1
     WHERE purge_after < now() AND lifecycle_state = 'recently_deleted'`,
  );
  return result.rowCount ?? 0;
}

export async function sweepPurgeQueue(pool: Pool): Promise<number> {
  const result = await pool.query(
    `DELETE FROM money_memos WHERE lifecycle_state = 'purging' AND updated_at < now() - interval '1 hour'`,
  );
  return result.rowCount ?? 0;
}
