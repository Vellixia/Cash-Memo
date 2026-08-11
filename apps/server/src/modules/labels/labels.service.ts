import { timingSafeEqual } from "node:crypto";

import { canonicalRequestHmac } from "@cashmemo/domain";
import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";
import type { Pool } from "pg";

import {
  type AccountTransaction,
  withAccountTransaction,
} from "../../adapters/postgres/transaction-context.js";
import { invalidateHistoryForLabelMutation } from "./history-invalidation.js";

export type LabelStatus = "active" | "inactive";
export type LabelListStatus = LabelStatus | "all";
export type CategoryKind = "income" | "expense";

export interface CategoryView {
  readonly id: string;
  readonly kind: CategoryKind;
  readonly name: string;
  readonly origin: "custom" | "starter";
  readonly revision: string;
  readonly status: LabelStatus;
}

export interface MoneySpaceView {
  readonly id: string;
  readonly name: string;
  readonly origin: "custom" | "starter";
  readonly revision: string;
  readonly status: LabelStatus;
}

export type LabelView = CategoryView | MoneySpaceView;

export type LabelErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "LABEL_CONFLICT"
  | "LABEL_KIND_MISMATCH"
  | "LABEL_NOT_FOUND"
  | "OPERATION_IN_PROGRESS"
  | "PRIVACY_BOUNDARY_BLOCKED"
  | "REVISION_CONFLICT"
  | "VALIDATION_ERROR";

export class LabelServiceError extends Error {
  constructor(readonly code: LabelErrorCode) {
    super(code);
    this.name = "LabelServiceError";
  }
}

export interface LabelsServiceOptions {
  readonly idempotencyHmacKey: Buffer;
  readonly pool: Pool;
  readonly privacy: PrivacyBoundaryPort;
}

export interface CreateCategoryInput {
  readonly idempotencyKey: string;
  readonly kind: CategoryKind;
  readonly name: string;
}

export interface CreateMoneySpaceInput {
  readonly idempotencyKey: string;
  readonly name: string;
}

export interface RenameLabelInput {
  readonly expectedRevision: string;
  readonly name: string;
}

interface LabelRow extends Record<string, unknown> {
  id: string;
  kind?: CategoryKind;
  name: string;
  revision: string;
  starter_key: string | null;
  status: LabelStatus;
}

interface IdempotencyRow extends Record<string, unknown> {
  request_hmac: Buffer;
  result_id: string | null;
  state: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REVISION = /^[1-9][0-9]*$/u;

function hasProhibitedControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export function normalizeLabelName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

function displayLabelName(name: string): string {
  const display = name.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (display.length < 1 || display.length > 80 || hasProhibitedControlCharacter(display)) {
    throw new LabelServiceError("VALIDATION_ERROR");
  }
  return display;
}

function assertIdentifier(value: string): void {
  if (!UUID.test(value)) throw new LabelServiceError("VALIDATION_ERROR");
}

function assertCategoryKind(value: unknown): asserts value is CategoryKind {
  if (value !== "income" && value !== "expense") {
    throw new LabelServiceError("VALIDATION_ERROR");
  }
}

function assertRevision(value: string): void {
  if (!REVISION.test(value)) throw new LabelServiceError("VALIDATION_ERROR");
}

function categoryView(row: LabelRow): CategoryView {
  if (row.kind !== "income" && row.kind !== "expense") {
    throw new LabelServiceError("LABEL_NOT_FOUND");
  }
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    origin: row.starter_key === null ? "custom" : "starter",
    revision: row.revision,
    status: row.status,
  };
}

function moneySpaceView(row: LabelRow): MoneySpaceView {
  return {
    id: row.id,
    name: row.name,
    origin: row.starter_key === null ? "custom" : "starter",
    revision: row.revision,
    status: row.status,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function sameHmac(first: Buffer, second: Buffer): boolean {
  return first.length === second.length && timingSafeEqual(first, second);
}

export class LabelsService {
  private readonly idempotencyHmacKey: Buffer;
  private readonly pool: Pool;
  private readonly privacy: PrivacyBoundaryPort;

  constructor(options: Readonly<LabelsServiceOptions>) {
    this.idempotencyHmacKey = options.idempotencyHmacKey;
    this.pool = options.pool;
    this.privacy = options.privacy;
  }

  async createCategory(
    accountId: string,
    input: Readonly<CreateCategoryInput>,
  ): Promise<CategoryView> {
    assertIdentifier(input.idempotencyKey);
    assertCategoryKind(input.kind);
    const name = await this.acceptName(input.name);
    const requestHmac = this.requestHmac("category_create", { kind: input.kind, name });
    try {
      return await withAccountTransaction(this.pool, accountId, async (transaction) => {
        return this.createCategoryInTransaction(transaction, input, name, requestHmac);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new LabelServiceError("LABEL_CONFLICT");
      throw error;
    }
  }

  async createMoneySpace(
    accountId: string,
    input: Readonly<CreateMoneySpaceInput>,
  ): Promise<MoneySpaceView> {
    assertIdentifier(input.idempotencyKey);
    const name = await this.acceptName(input.name);
    const requestHmac = this.requestHmac("money_space_create", { name });
    try {
      return await withAccountTransaction(this.pool, accountId, async (transaction) => {
        return this.createMoneySpaceInTransaction(transaction, input, name, requestHmac);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new LabelServiceError("LABEL_CONFLICT");
      throw error;
    }
  }

  async listCategories(
    accountId: string,
    filters: { readonly kind?: CategoryKind; readonly status?: LabelListStatus } = {},
  ): Promise<readonly CategoryView[]> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const values: unknown[] = [accountId];
      const predicates = ["user_id = $1"];
      if (filters.status !== undefined && filters.status !== "all") {
        values.push(filters.status);
        predicates.push(`status = $${String(values.length)}`);
      }
      if (filters.kind !== undefined) {
        values.push(filters.kind);
        predicates.push(`kind = $${String(values.length)}`);
      }
      const result = await transaction.query<LabelRow>(
        `SELECT id, kind, name, status, starter_key, revision::text
         FROM categories WHERE ${predicates.join(" AND ")}
         ORDER BY normalized_name, id`,
        values,
      );
      return result.rows.map(categoryView);
    });
  }

  async listMoneySpaces(
    accountId: string,
    filters: { readonly status?: LabelListStatus } = {},
  ): Promise<readonly MoneySpaceView[]> {
    return withAccountTransaction(this.pool, accountId, async (transaction) => {
      const values: unknown[] = [accountId];
      const predicates = ["user_id = $1"];
      if (filters.status !== undefined && filters.status !== "all") {
        values.push(filters.status);
        predicates.push(`status = $${String(values.length)}`);
      }
      const result = await transaction.query<LabelRow>(
        `SELECT id, name, status, starter_key, revision::text
         FROM money_spaces WHERE ${predicates.join(" AND ")}
         ORDER BY normalized_name, id`,
        values,
      );
      return result.rows.map(moneySpaceView);
    });
  }

  async renameCategory(
    accountId: string,
    id: string,
    input: Readonly<RenameLabelInput>,
  ): Promise<CategoryView> {
    const name = await this.acceptName(input.name);
    return this.mutateCategory(accountId, id, input.expectedRevision, {
      name,
      normalizedName: normalizeLabelName(name),
      operation: "rename",
    });
  }

  async renameMoneySpace(
    accountId: string,
    id: string,
    input: Readonly<RenameLabelInput>,
  ): Promise<MoneySpaceView> {
    const name = await this.acceptName(input.name);
    return this.mutateMoneySpace(accountId, id, input.expectedRevision, {
      name,
      normalizedName: normalizeLabelName(name),
      operation: "rename",
    });
  }

  async deactivateCategory(
    accountId: string,
    id: string,
    expectedRevision: string,
  ): Promise<CategoryView> {
    return this.mutateCategory(accountId, id, expectedRevision, {
      operation: "status",
      requiredStatus: "active",
      status: "inactive",
    });
  }

  async restoreCategory(
    accountId: string,
    id: string,
    expectedRevision: string,
  ): Promise<CategoryView> {
    return this.mutateCategory(accountId, id, expectedRevision, {
      operation: "status",
      requiredStatus: "inactive",
      status: "active",
    });
  }

  async deactivateMoneySpace(
    accountId: string,
    id: string,
    expectedRevision: string,
  ): Promise<MoneySpaceView> {
    return this.mutateMoneySpace(accountId, id, expectedRevision, {
      operation: "status",
      requiredStatus: "active",
      status: "inactive",
    });
  }

  async restoreMoneySpace(
    accountId: string,
    id: string,
    expectedRevision: string,
  ): Promise<MoneySpaceView> {
    return this.mutateMoneySpace(accountId, id, expectedRevision, {
      operation: "status",
      requiredStatus: "inactive",
      status: "active",
    });
  }

  private async acceptName(input: string): Promise<string> {
    if (typeof input !== "string") throw new LabelServiceError("VALIDATION_ERROR");
    const evaluation = await this.privacy.evaluateText({
      boundary: "label_persistence",
      content: input,
      ruleSetVersion: "privacy-rules-v1",
    });
    if (evaluation.decision !== "allow") {
      throw new LabelServiceError("PRIVACY_BOUNDARY_BLOCKED");
    }
    return displayLabelName(input);
  }

  private requestHmac(operation: string, payload: unknown): Buffer {
    return Buffer.from(
      canonicalRequestHmac({
        hmacKey: this.idempotencyHmacKey,
        operation,
        payload,
        schemaVersion: "label-create-v1",
      }),
      "hex",
    );
  }

  private async createCategoryInTransaction(
    transaction: AccountTransaction,
    input: Readonly<CreateCategoryInput>,
    name: string,
    requestHmac: Buffer,
  ): Promise<CategoryView> {
    const replay = await this.findIdempotentLabel(
      transaction,
      "category_create",
      input.idempotencyKey,
      requestHmac,
      "categories",
    );
    if (replay !== null) return categoryView(replay);
    await this.beginIdempotency(transaction, "category_create", input.idempotencyKey, requestHmac);
    const result = await transaction.query<LabelRow>(
      `INSERT INTO categories (id, user_id, kind, name, normalized_name)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING id, kind, name, status, starter_key, revision::text`,
      [transaction.authenticatedAccountId, input.kind, name, normalizeLabelName(name)],
    );
    const row = result.rows[0];
    if (row === undefined) throw new LabelServiceError("LABEL_NOT_FOUND");
    await this.completeIdempotency(
      transaction,
      "category_create",
      input.idempotencyKey,
      row.id,
      row.revision,
      "category",
    );
    return categoryView(row);
  }

  private async createMoneySpaceInTransaction(
    transaction: AccountTransaction,
    input: Readonly<CreateMoneySpaceInput>,
    name: string,
    requestHmac: Buffer,
  ): Promise<MoneySpaceView> {
    const replay = await this.findIdempotentLabel(
      transaction,
      "money_space_create",
      input.idempotencyKey,
      requestHmac,
      "money_spaces",
    );
    if (replay !== null) return moneySpaceView(replay);
    await this.beginIdempotency(
      transaction,
      "money_space_create",
      input.idempotencyKey,
      requestHmac,
    );
    const result = await transaction.query<LabelRow>(
      `INSERT INTO money_spaces (id, user_id, name, normalized_name)
       VALUES (gen_random_uuid(), $1, $2, $3)
       RETURNING id, name, status, starter_key, revision::text`,
      [transaction.authenticatedAccountId, name, normalizeLabelName(name)],
    );
    const row = result.rows[0];
    if (row === undefined) throw new LabelServiceError("LABEL_NOT_FOUND");
    await this.completeIdempotency(
      transaction,
      "money_space_create",
      input.idempotencyKey,
      row.id,
      row.revision,
      "money_space",
    );
    return moneySpaceView(row);
  }

  private async findIdempotentLabel(
    transaction: AccountTransaction,
    operation: "category_create" | "money_space_create",
    key: string,
    requestHmac: Buffer,
    table: "categories" | "money_spaces",
  ): Promise<LabelRow | null> {
    const existing = await transaction.query<IdempotencyRow>(
      `SELECT state, request_hmac, result_id
       FROM idempotency_records WHERE user_id = $1 AND operation = $2 AND key = $3`,
      [transaction.authenticatedAccountId, operation, key],
    );
    const record = existing.rows[0];
    if (record === undefined) return null;
    if (!sameHmac(record.request_hmac, requestHmac)) {
      throw new LabelServiceError("IDEMPOTENCY_CONFLICT");
    }
    if (record.state === "in_progress") throw new LabelServiceError("OPERATION_IN_PROGRESS");
    if (record.state !== "succeeded" || record.result_id === null) {
      throw new LabelServiceError("OPERATION_IN_PROGRESS");
    }
    const label = await transaction.query<LabelRow>(
      `SELECT id, ${table === "categories" ? "kind," : ""} name, status, starter_key, revision::text
       FROM ${table} WHERE id = $1 AND user_id = $2`,
      [record.result_id, transaction.authenticatedAccountId],
    );
    const row = label.rows[0];
    if (row === undefined) throw new LabelServiceError("LABEL_NOT_FOUND");
    return row;
  }

  private async beginIdempotency(
    transaction: AccountTransaction,
    operation: "category_create" | "money_space_create",
    key: string,
    requestHmac: Buffer,
  ): Promise<void> {
    await transaction.query(
      `INSERT INTO idempotency_records
         (id, user_id, operation, key, request_hmac, state, expires_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'in_progress', now() + interval '35 days')`,
      [transaction.authenticatedAccountId, operation, key, requestHmac],
    );
  }

  private async completeIdempotency(
    transaction: AccountTransaction,
    operation: "category_create" | "money_space_create",
    key: string,
    resultId: string,
    revision: string,
    resultType: "category" | "money_space",
  ): Promise<void> {
    await transaction.query(
      `UPDATE idempotency_records SET state = 'succeeded', result_type = $4, result_id = $1,
         result_revision = $2, response_code = 'created', updated_at = now()
       WHERE user_id = $3 AND operation = $5 AND key = $6`,
      [resultId, revision, transaction.authenticatedAccountId, resultType, operation, key],
    );
  }

  private async mutateCategory(
    accountId: string,
    id: string,
    expectedRevision: string,
    mutation: Readonly<LabelMutation>,
  ): Promise<CategoryView> {
    return this.mutateLabel(accountId, "categories", id, expectedRevision, mutation, categoryView);
  }

  private async mutateMoneySpace(
    accountId: string,
    id: string,
    expectedRevision: string,
    mutation: Readonly<LabelMutation>,
  ): Promise<MoneySpaceView> {
    return this.mutateLabel(
      accountId,
      "money_spaces",
      id,
      expectedRevision,
      mutation,
      moneySpaceView,
    );
  }

  private async mutateLabel<View extends LabelView>(
    accountId: string,
    table: "categories" | "money_spaces",
    id: string,
    expectedRevision: string,
    mutation: Readonly<LabelMutation>,
    map: (row: LabelRow) => View,
  ): Promise<View> {
    assertIdentifier(id);
    assertRevision(expectedRevision);
    try {
      return await withAccountTransaction(this.pool, accountId, async (transaction) => {
        const assignments = ["updated_at = now()", "revision = revision + 1"];
        const values: unknown[] = [id, transaction.authenticatedAccountId, expectedRevision];
        if (mutation.operation === "rename") {
          values.push(mutation.name, mutation.normalizedName);
          assignments.push(`name = $${String(values.length - 1)}`);
          assignments.push(`normalized_name = $${String(values.length)}`);
        } else {
          values.push(mutation.status);
          assignments.push(`status = $${String(values.length)}`);
        }
        const predicates = ["id = $1", "user_id = $2", "revision = $3"];
        if (mutation.operation === "status") {
          values.push(mutation.requiredStatus);
          predicates.push(`status = $${String(values.length)}`);
        }
        const result = await transaction.query<LabelRow>(
          `UPDATE ${table} SET ${assignments.join(", ")}
           WHERE ${predicates.join(" AND ")}
           RETURNING id, ${table === "categories" ? "kind," : ""} name, status, starter_key, revision::text`,
          values,
        );
        const row = result.rows[0];
        if (row === undefined) {
          return this.classifyMutationFailure(transaction, table, id, expectedRevision);
        }
        await invalidateHistoryForLabelMutation(transaction);
        return map(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new LabelServiceError("LABEL_CONFLICT");
      throw error;
    }
  }

  private async classifyMutationFailure(
    transaction: AccountTransaction,
    table: "categories" | "money_spaces",
    id: string,
    expectedRevision: string,
  ): Promise<never> {
    const current = await transaction.query<{ revision: string }>(
      `SELECT revision::text FROM ${table} WHERE id = $1 AND user_id = $2`,
      [id, transaction.authenticatedAccountId],
    );
    const row = current.rows[0];
    if (row !== undefined) {
      if (row.revision !== expectedRevision) throw new LabelServiceError("REVISION_CONFLICT");
      throw new LabelServiceError("INVALID_STATE_TRANSITION");
    }
    const otherTable = table === "categories" ? "money_spaces" : "categories";
    const wrongKind = await transaction.query(
      `SELECT id FROM ${otherTable} WHERE id = $1 AND user_id = $2`,
      [id, transaction.authenticatedAccountId],
    );
    if (wrongKind.rowCount !== 0) throw new LabelServiceError("LABEL_KIND_MISMATCH");
    throw new LabelServiceError("LABEL_NOT_FOUND");
  }
}

type LabelMutation =
  | {
      readonly name: string;
      readonly normalizedName: string;
      readonly operation: "rename";
    }
  | {
      readonly operation: "status";
      readonly requiredStatus: LabelStatus;
      readonly status: LabelStatus;
    };
