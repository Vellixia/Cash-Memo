import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";

export interface ComposeDraftInput {
  readonly origin: "manual" | "natural_language" | "voice";
  readonly sourceText: string | null;
  readonly sourceCompleteness: "complete" | "incomplete" | "not_applicable";
  readonly candidateFields: Record<string, unknown>;
  readonly captureStartedAt: string;
  readonly captureTimezone: string;
}

export interface ComposeDraftView {
  readonly id: string;
  readonly origin: string;
  readonly sourceText: string | null;
  readonly sourceCompleteness: string;
  readonly status: string;
  readonly revision: string;
  readonly expiresAt: string;
  readonly lastActivityAt: string;
}

export async function createDraft(
  pool: Pool,
  accountId: string,
  input: Readonly<ComposeDraftInput>,
): Promise<ComposeDraftView> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const result = await tx.query<Record<string, unknown>>(
      `INSERT INTO compose_drafts (
        id, user_id, origin, source_text, source_completeness,
        candidate_fields, field_provenance, capture_started_at, capture_timezone,
        status, last_activity_at, expires_at, revision
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, '{}'::jsonb, $6, $7,
        'editing', now(), now() + interval '7 days', 1
      ) RETURNING *`,
      [
        accountId,
        input.origin,
        input.sourceText,
        input.sourceCompleteness,
        JSON.stringify(input.candidateFields),
        input.captureStartedAt,
        input.captureTimezone,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("DRAFT_CREATE_FAILED");
    return mapDraftRow(row);
  });
}

export async function updateDraft(
  pool: Pool,
  accountId: string,
  draftId: string,
  input: {
    sourceText: string | null;
    sourceCompleteness: string;
    candidateFields: Record<string, unknown>;
  },
  expectedRevision: string,
): Promise<ComposeDraftView> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const result = await tx.query<Record<string, unknown>>(
      `UPDATE compose_drafts SET
        source_text = $3, source_completeness = $4, candidate_fields = $5,
        last_activity_at = now(), expires_at = now() + interval '7 days',
        revision = revision + 1
      WHERE id = $1 AND user_id = $2 AND revision = $6
      RETURNING *`,
      [
        draftId,
        accountId,
        input.sourceText,
        input.sourceCompleteness,
        JSON.stringify(input.candidateFields),
        expectedRevision,
      ],
    );
    if (result.rowCount === 0) throw new Error("REVISION_CONFLICT");
    const row = result.rows[0];
    if (row === undefined) throw new Error("DRAFT_UPDATE_FAILED");
    return mapDraftRow(row);
  });
}

export async function listDrafts(pool: Pool, accountId: string): Promise<ComposeDraftView[]> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const result = await tx.query<Record<string, unknown>>(
      `SELECT * FROM compose_drafts WHERE user_id = $1 AND status IN ('editing', 'reviewable')
       ORDER BY last_activity_at DESC`,
      [accountId],
    );
    return result.rows.map(mapDraftRow);
  });
}

export async function discardDraft(pool: Pool, accountId: string, draftId: string): Promise<void> {
  await withAccountTransaction(pool, accountId, async (tx) => {
    await tx.query(
      `UPDATE compose_drafts SET status = 'failed_recoverable', last_activity_at = now()
       WHERE id = $1 AND user_id = $2`,
      [draftId, accountId],
    );
  });
}

function mapDraftRow(row: Record<string, unknown>): ComposeDraftView {
  return {
    id: row["id"] as string,
    lastActivityAt: row["last_activity_at"] as string,
    origin: row["origin"] as string,
    revision: String(row["revision"]),
    sourceCompleteness: row["source_completeness"] as string,
    sourceText: row["source_text"] as string | null,
    status: row["status"] as string,
    expiresAt: row["expires_at"] as string,
  };
}
