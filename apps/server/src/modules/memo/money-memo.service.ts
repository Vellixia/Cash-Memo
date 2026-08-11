import { parseMoney, serializeMoney, Money, type MoneyInput } from "@cashmemo/domain";
import { currencyRegistryV1 } from "@cashmemo/currency-registry";

import type { AccountTransaction } from "../../adapters/postgres/transaction-context.js";

export interface MoneyMemoInput {
  readonly direction: "income" | "expense";
  readonly money: MoneyInput;
  readonly occurrence: {
    readonly occurredAt: string;
    readonly occurredLocal: string;
    readonly occurredTimezone: string;
    readonly occurredOffsetMinutes: number;
    readonly timezoneDatabaseVersion: string;
  };
  readonly categoryId: string | null;
  readonly moneySpaceId: string | null;
  readonly purpose: "personal" | "work" | "mixed" | null;
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly note: string | null;
}

export interface MoneyMemoView {
  readonly id: string;
  readonly direction: "income" | "expense";
  readonly money: {
    readonly amount: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly currencyExponent: number;
    readonly currencyRegistryVersion: string;
  };
  readonly occurrence: {
    readonly occurredAt: string;
    readonly occurredLocal: string;
    readonly occurredTimezone: string;
    readonly occurredOffsetMinutes: number;
    readonly timezoneDatabaseVersion: string;
  };
  readonly categoryId: string | null;
  readonly moneySpaceId: string | null;
  readonly purpose: "personal" | "work" | "mixed" | null;
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly note: string | null;
  readonly origin: "manual" | "natural_language" | "voice";
  readonly lifecycleState: "active" | "archived";
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class MoneyMemoServiceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MoneyMemoServiceError";
  }
}

export function mapMoneyMemoRow(row: Record<string, unknown>): MoneyMemoView {
  return {
    categoryId: row["category_id"] as string | null,
    createdAt: row["created_at"] as string,
    direction: row["direction"] as "income" | "expense",
    id: row["id"] as string,
    lifecycleState: row["lifecycle_state"] as "active" | "archived",
    money: {
      amount: serializeMoney(
        Money.fromMinor({
          amountMinor: row["amount_minor"] as string,
          currency: row["currency_code"] as string,
          currencyExponent: row["currency_exponent"] as number,
          currencyRegistryVersion: row["currency_registry_version"] as string,
        }),
      ).amount,
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
    origin: row["origin"] as "manual" | "natural_language" | "voice",
    planningStatus: row["planning_status"] as "planned" | "unplanned" | null,
    purpose: row["purpose"] as "personal" | "work" | "mixed" | null,
    revision: String(row["revision"]),
    updatedAt: row["updated_at"] as string,
  };
}

export async function createMoneyMemo(
  transaction: AccountTransaction,
  input: Readonly<MoneyMemoInput>,
  idempotencyKey: string,
  requestHmac: Buffer,
): Promise<MoneyMemoView> {
  const money = parseMoney(input.money, currencyRegistryV1);
  const serialized = serializeMoney(money);

  const existing = await transaction.query<{
    id: string;
    state: string;
    result_id: string;
    result_revision: string;
  }>(
    `SELECT id, state, result_id, result_revision::text
       FROM idempotency_records
      WHERE user_id = $1 AND operation = 'memo_create' AND key = $2`,
    [transaction.authenticatedAccountId, idempotencyKey],
  );

  if (existing.rowCount !== 0) {
    const row = existing.rows[0];
    if (row === undefined) throw new MoneyMemoServiceError("IDEMPOTENCY_LOOKUP_FAILED");
    if (row.state === "succeeded") {
      const memo = await transaction.query<Record<string, unknown>>(
        `SELECT * FROM money_memos WHERE id = $1`,
        [row.result_id],
      );
      if (memo.rowCount === 0) throw new MoneyMemoServiceError("MEMO_NOT_FOUND");
      const memoRow = memo.rows[0];
      if (memoRow === undefined) throw new MoneyMemoServiceError("MEMO_NOT_FOUND");
      return mapMoneyMemoRow(memoRow);
    }
    if (row.state === "in_progress") {
      throw new MoneyMemoServiceError("OPERATION_IN_PROGRESS");
    }
  }

  await transaction.query(
    `INSERT INTO idempotency_records
       (id, user_id, operation, key, request_hmac, state, expires_at)
     VALUES (gen_random_uuid(), $1, 'memo_create', $2, $3, 'in_progress', now() + interval '35 days')`,
    [transaction.authenticatedAccountId, idempotencyKey, requestHmac],
  );

  const result = await transaction.query<Record<string, unknown>>(
    `INSERT INTO money_memos (
       id, user_id, direction, amount_minor, currency_code, currency_exponent,
       currency_registry_version, occurred_at, occurred_local, occurred_timezone,
       occurred_offset_minutes, timezone_database_version, category_id, money_space_id,
       purpose, planning_status, note, origin, lifecycle_state, revision
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, 'manual', 'active', 1
     ) RETURNING *`,
    [
      transaction.authenticatedAccountId,
      input.direction,
      serialized.amountMinor,
      serialized.currency,
      serialized.currencyExponent,
      serialized.currencyRegistryVersion,
      input.occurrence.occurredAt,
      input.occurrence.occurredLocal,
      input.occurrence.occurredTimezone,
      input.occurrence.occurredOffsetMinutes,
      input.occurrence.timezoneDatabaseVersion,
      input.categoryId,
      input.moneySpaceId,
      input.purpose,
      input.planningStatus,
      input.note,
    ],
  );

  if (result.rowCount === 0) throw new MoneyMemoServiceError("MEMO_CREATE_FAILED");
  const memoRow = result.rows[0];
  if (memoRow === undefined) throw new MoneyMemoServiceError("MEMO_CREATE_FAILED");
  const memo = mapMoneyMemoRow(memoRow);

  await transaction.query(
    `UPDATE idempotency_records
        SET state = 'succeeded', result_type = 'memo', result_id = $1,
            result_revision = $2, response_code = 'created', expires_at = now() + interval '35 days'
      WHERE user_id = $3 AND operation = 'memo_create' AND key = $4`,
    [memo.id, memo.revision, transaction.authenticatedAccountId, idempotencyKey],
  );

  await transaction.query(
    `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
    [transaction.authenticatedAccountId],
  );

  return memo;
}

export async function updateMoneyMemo(
  transaction: AccountTransaction,
  memoId: string,
  input: Readonly<MoneyMemoInput>,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  const money = parseMoney(input.money, currencyRegistryV1);
  const serialized = serializeMoney(money);

  const result = await transaction.query<Record<string, unknown>>(
    `UPDATE money_memos SET
       direction = $3, amount_minor = $4, currency_code = $5, currency_exponent = $6,
       currency_registry_version = $7, occurred_at = $8, occurred_local = $9,
       occurred_timezone = $10, occurred_offset_minutes = $11, timezone_database_version = $12,
       category_id = $13, money_space_id = $14, purpose = $15, planning_status = $16,
       note = $17, updated_at = now(), revision = revision + 1
     WHERE id = $1 AND user_id = $2 AND revision = $18 AND lifecycle_state IN ('active', 'archived')
     RETURNING *`,
    [
      memoId,
      transaction.authenticatedAccountId,
      input.direction,
      serialized.amountMinor,
      serialized.currency,
      serialized.currencyExponent,
      serialized.currencyRegistryVersion,
      input.occurrence.occurredAt,
      input.occurrence.occurredLocal,
      input.occurrence.occurredTimezone,
      input.occurrence.occurredOffsetMinutes,
      input.occurrence.timezoneDatabaseVersion,
      input.categoryId,
      input.moneySpaceId,
      input.purpose,
      input.planningStatus,
      input.note,
      expectedRevision,
    ],
  );

  if (result.rowCount === 0) {
    const check = await transaction.query<{ revision: string }>(
      `SELECT revision::text FROM money_memos WHERE id = $1 AND user_id = $2`,
      [memoId, transaction.authenticatedAccountId],
    );
    if (check.rowCount === 0) throw new MoneyMemoServiceError("MEMO_NOT_FOUND");
    throw new MoneyMemoServiceError("REVISION_CONFLICT");
  }

  const row = result.rows[0];
  if (row === undefined) throw new MoneyMemoServiceError("MEMO_UPDATE_FAILED");
  const memo = mapMoneyMemoRow(row);

  await transaction.query(
    `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
    [transaction.authenticatedAccountId],
  );

  return memo;
}

export async function getMoneyMemo(
  transaction: AccountTransaction,
  memoId: string,
): Promise<MoneyMemoView> {
  const result = await transaction.query<Record<string, unknown>>(
    `SELECT * FROM money_memos WHERE id = $1 AND user_id = $2 AND lifecycle_state IN ('active', 'archived')`,
    [memoId, transaction.authenticatedAccountId],
  );
  if (result.rowCount === 0) throw new MoneyMemoServiceError("MEMO_NOT_FOUND");
  const row = result.rows[0];
  if (row === undefined) throw new MoneyMemoServiceError("MEMO_NOT_FOUND");
  return mapMoneyMemoRow(row);
}

export async function archiveMoneyMemo(
  transaction: AccountTransaction,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  const result = await transaction.query<Record<string, unknown>>(
    `UPDATE money_memos SET lifecycle_state = 'archived', updated_at = now(), revision = revision + 1
     WHERE id = $1 AND user_id = $2 AND revision = $3 AND lifecycle_state = 'active'
     RETURNING *`,
    [memoId, transaction.authenticatedAccountId, expectedRevision],
  );
  if (result.rowCount === 0) throw new MoneyMemoServiceError("REVISION_CONFLICT");
  const row = result.rows[0];
  if (row === undefined) throw new MoneyMemoServiceError("ARCHIVE_FAILED");
  return mapMoneyMemoRow(row);
}

export async function restoreArchivedMoneyMemo(
  transaction: AccountTransaction,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  const result = await transaction.query<Record<string, unknown>>(
    `UPDATE money_memos SET lifecycle_state = 'active', updated_at = now(), revision = revision + 1
     WHERE id = $1 AND user_id = $2 AND revision = $3 AND lifecycle_state = 'archived'
     RETURNING *`,
    [memoId, transaction.authenticatedAccountId, expectedRevision],
  );
  if (result.rowCount === 0) throw new MoneyMemoServiceError("REVISION_CONFLICT");
  const row = result.rows[0];
  if (row === undefined) throw new MoneyMemoServiceError("RESTORE_FAILED");
  return mapMoneyMemoRow(row);
}

export async function moveToRecentlyDeleted(
  transaction: AccountTransaction,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  const result = await transaction.query<Record<string, unknown>>(
    `UPDATE money_memos SET
       lifecycle_state = 'recently_deleted',
       prior_lifecycle_state = lifecycle_state::text::memo_prior_lifecycle_state,
       deleted_at = now(),
       purge_after = now() + interval '30 days',
       updated_at = now(),
       revision = revision + 1
     WHERE id = $1 AND user_id = $2 AND revision = $3 AND lifecycle_state IN ('active', 'archived')
     RETURNING *`,
    [memoId, transaction.authenticatedAccountId, expectedRevision],
  );
  if (result.rowCount === 0) throw new MoneyMemoServiceError("REVISION_CONFLICT");
  const row = result.rows[0];
  if (row === undefined) throw new MoneyMemoServiceError("DELETE_FAILED");
  return mapMoneyMemoRow(row);
}

export async function restoreRecentlyDeleted(
  transaction: AccountTransaction,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  const result = await transaction.query<Record<string, unknown>>(
    `UPDATE money_memos SET
       lifecycle_state = prior_lifecycle_state::text::memo_lifecycle_state,
       prior_lifecycle_state = NULL,
       deleted_at = NULL,
       purge_after = NULL,
       updated_at = now(),
       revision = revision + 1
     WHERE id = $1 AND user_id = $2 AND revision = $3 AND lifecycle_state = 'recently_deleted'
     RETURNING *`,
    [memoId, transaction.authenticatedAccountId, expectedRevision],
  );
  if (result.rowCount === 0) throw new MoneyMemoServiceError("REVISION_CONFLICT");
  const row = result.rows[0];
  if (row === undefined) throw new MoneyMemoServiceError("RESTORE_FAILED");
  return mapMoneyMemoRow(row);
}

export async function initiatePurge(
  transaction: AccountTransaction,
  memoId: string,
  expectedRevision: string,
): Promise<MoneyMemoView> {
  const result = await transaction.query<Record<string, unknown>>(
    `UPDATE money_memos SET
       lifecycle_state = 'purging',
       updated_at = now(),
       revision = revision + 1
     WHERE id = $1 AND user_id = $2 AND revision = $3 AND lifecycle_state = 'recently_deleted'
     RETURNING *`,
    [memoId, transaction.authenticatedAccountId, expectedRevision],
  );
  if (result.rowCount === 0) throw new MoneyMemoServiceError("REVISION_CONFLICT");
  const row = result.rows[0];
  if (row === undefined) throw new MoneyMemoServiceError("PURGE_INITIATION_FAILED");
  return mapMoneyMemoRow(row);
}
