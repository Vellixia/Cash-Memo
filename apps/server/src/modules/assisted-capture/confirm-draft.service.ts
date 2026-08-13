import type { Pool } from "pg";

import { currencyRegistryV1 } from "@cashmemo/currency-registry";
import {
  canonicalRequestHmac,
  parseMoney,
  serializeMoney,
  validateOccurrenceTuple,
} from "@cashmemo/domain";
import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import {
  mapMoneyMemoRow,
  type MoneyMemoInput,
  type MoneyMemoView,
} from "../memo/application/ports/money-memo.port.js";

export class DraftConfirmationError extends Error {
  constructor(
    readonly code:
      | "DRAFT_ALREADY_CONFIRMED"
      | "DRAFT_EXPIRED"
      | "DRAFT_NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "PRIVACY_BOUNDARY_BLOCKED"
      | "REVISION_CONFLICT"
      | "VALIDATION_ERROR",
  ) {
    super(code);
    this.name = "DraftConfirmationError";
  }
}

export interface ConfirmDraftInput {
  readonly confirmation: string;
  readonly expectedRevision: string;
  readonly memo: MoneyMemoInput;
}

export class ConfirmDraftService {
  constructor(
    private readonly options: {
      readonly hmacKey: Buffer;
      readonly pool: Pool;
      readonly privacy: PrivacyBoundaryPort;
    },
  ) {}

  async confirm(
    accountId: string,
    draftId: string,
    idempotencyKey: string,
    input: Readonly<ConfirmDraftInput>,
  ): Promise<MoneyMemoView> {
    if (input.confirmation !== "CONFIRM_MONEY_MEMO")
      throw new DraftConfirmationError("VALIDATION_ERROR");
    const privacy = await this.options.privacy.evaluateText({
      boundary: "memo_note_persistence",
      content: input.memo.note ?? "",
      ruleSetVersion: "privacy-detector-v1",
    });
    if (privacy.decision !== "allow") throw new DraftConfirmationError("PRIVACY_BOUNDARY_BLOCKED");

    let serialized;
    try {
      serialized = serializeMoney(parseMoney(input.memo.money, currencyRegistryV1));
      validateOccurrenceTuple(input.memo.occurrence, { now: new Date().toISOString() });
    } catch {
      throw new DraftConfirmationError("VALIDATION_ERROR");
    }
    const requestHmac = Buffer.from(
      canonicalRequestHmac({
        hmacKey: this.options.hmacKey,
        operation: "draft_confirmation",
        payload: { draftId, input },
        schemaVersion: "draft-confirmation-v1",
      }),
      "hex",
    );

    return withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const replay = await transaction.query<{
        request_hmac: Buffer;
        result_id: string;
        state: string;
      }>(
        `SELECT request_hmac, result_id, state FROM idempotency_records
          WHERE user_id = $1 AND operation = 'draft_confirmation' AND key = $2`,
        [accountId, idempotencyKey],
      );
      const existing = replay.rows[0];
      if (existing !== undefined) {
        if (!existing.request_hmac.equals(requestHmac))
          throw new DraftConfirmationError("IDEMPOTENCY_CONFLICT");
        if (existing.state !== "succeeded")
          throw new DraftConfirmationError("IDEMPOTENCY_CONFLICT");
        const memo = await transaction.query<Record<string, unknown>>(
          `SELECT * FROM money_memos WHERE id = $1 AND user_id = $2`,
          [existing.result_id, accountId],
        );
        const row = memo.rows[0];
        if (row === undefined) throw new DraftConfirmationError("DRAFT_NOT_FOUND");
        return mapMoneyMemoRow(row);
      }

      const priorConfirmation = await transaction.query(
        `SELECT 1 FROM idempotency_records
          WHERE user_id = $1 AND operation = 'draft_confirmation'
            AND result_type = $2 AND state = 'succeeded' LIMIT 1`,
        [accountId, `assisted_draft:${draftId}`],
      );
      if (priorConfirmation.rowCount !== 0)
        throw new DraftConfirmationError("DRAFT_ALREADY_CONFIRMED");

      const drafts = await transaction.query<{
        expires_at: Date;
        origin: string;
        revision: string;
        status: string;
      }>(
        `SELECT expires_at, origin, revision::text, status FROM compose_drafts
          WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [draftId, accountId],
      );
      const draft = drafts.rows[0];
      if (draft === undefined) throw new DraftConfirmationError("DRAFT_NOT_FOUND");
      if (draft.expires_at.getTime() <= Date.now())
        throw new DraftConfirmationError("DRAFT_EXPIRED");
      if (draft.revision !== input.expectedRevision)
        throw new DraftConfirmationError("REVISION_CONFLICT");
      if (draft.status !== "reviewable" && draft.status !== "editing")
        throw new DraftConfirmationError("VALIDATION_ERROR");

      if (input.memo.categoryId !== null) {
        const category = await transaction.query<{ kind: string }>(
          `SELECT kind FROM categories WHERE id = $1 AND user_id = $2 AND status = 'active'`,
          [input.memo.categoryId, accountId],
        );
        if (category.rows[0]?.kind !== input.memo.direction)
          throw new DraftConfirmationError("VALIDATION_ERROR");
      }
      if (input.memo.moneySpaceId !== null) {
        const space = await transaction.query(
          `SELECT 1 FROM money_spaces WHERE id = $1 AND user_id = $2 AND status = 'active'`,
          [input.memo.moneySpaceId, accountId],
        );
        if (space.rowCount === 0) throw new DraftConfirmationError("VALIDATION_ERROR");
      }

      try {
        await transaction.query(
          `INSERT INTO idempotency_records
             (id, user_id, operation, key, request_hmac, state, expires_at)
           VALUES (gen_random_uuid(), $1, 'draft_confirmation', $2, $3, 'in_progress', now() + interval '35 days')`,
          [accountId, idempotencyKey, requestHmac],
        );
      } catch {
        throw new DraftConfirmationError("IDEMPOTENCY_CONFLICT");
      }

      const result = await transaction.query<Record<string, unknown>>(
        `INSERT INTO money_memos (
           id, user_id, direction, amount_minor, currency_code, currency_exponent,
           currency_registry_version, occurred_at, occurred_local, occurred_timezone,
           occurred_offset_minutes, timezone_database_version, category_id, money_space_id,
           purpose, planning_status, note, origin, lifecycle_state, revision
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17::memo_origin, 'active', 1
         ) RETURNING *`,
        [
          accountId,
          input.memo.direction,
          serialized.amountMinor,
          serialized.currency,
          serialized.currencyExponent,
          serialized.currencyRegistryVersion,
          input.memo.occurrence.occurredAt,
          input.memo.occurrence.occurredLocal,
          input.memo.occurrence.occurredTimezone,
          input.memo.occurrence.occurredOffsetMinutes,
          input.memo.occurrence.timezoneDatabaseVersion,
          input.memo.categoryId,
          input.memo.moneySpaceId,
          input.memo.purpose,
          input.memo.planningStatus,
          input.memo.note,
          draft.origin,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw new DraftConfirmationError("VALIDATION_ERROR");
      const memo = mapMoneyMemoRow(row);
      await transaction.query(
        `UPDATE idempotency_records SET state = 'succeeded', result_type = $1,
          result_id = $2, result_revision = 1, response_code = 'created', updated_at = now()
          WHERE user_id = $3 AND operation = 'draft_confirmation' AND key = $4`,
        [`assisted_draft:${draftId}`, memo.id, accountId, idempotencyKey],
      );
      await transaction.query(
        `UPDATE compose_drafts SET source_text = NULL, candidate_fields = '{}'::jsonb,
          field_provenance = '[]'::jsonb, status = 'failed_recoverable', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [draftId, accountId],
      );
      await transaction.query(
        `UPDATE assisted_captures SET state = 'cleanup_scheduled', updated_at = now(), revision = revision + 1
          WHERE draft_id = $1 AND user_id = $2`,
        [draftId, accountId],
      );
      await transaction.query(
        `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
        [accountId],
      );
      return memo;
    });
  }
}
