import { randomUUID } from "node:crypto";

import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LabelsService,
  LabelServiceError,
  normalizeLabelName,
} from "../../src/modules/labels/labels.service.js";
import { applyMigrations } from "../integration/support/postgres-migrations.js";
import {
  startTestEnvironment,
  type TestEnvironment,
} from "../integration/support/test-environment.js";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_HMAC_KEY = Buffer.from("labels-contract-idempotency-key-32-bytes", "utf8");

const allowPrivacy: PrivacyBoundaryPort = {
  evaluateText() {
    return Promise.resolve({
      decision: "allow",
      matched: false,
      ruleFamily: null,
      warningCode: null,
    });
  },
};

describe("Category and Money Space contracts (FR-051–FR-055)", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;
  let runtimePool: Pool;
  let labels: LabelsService;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'label-a@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'label-b@cashmemo.test', true, 'active')`,
      [ACCOUNT_A, ACCOUNT_B],
    );
    runtimePool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_runtime",
    });
    labels = new LabelsService({
      idempotencyHmacKey: IDEMPOTENCY_HMAC_KEY,
      pool: runtimePool,
      privacy: allowPrivacy,
    });
  }, 120_000);

  afterAll(async () => {
    await runtimePool.end();
    await adminPool.end();
    await environment.stop();
  });

  it("normalizes case, surrounding/repeated whitespace, and canonical Unicode only", () => {
    expect(normalizeLabelName("  Travel   Work  ")).toBe("travel work");
    expect(normalizeLabelName("TRAVEL WORK")).toBe("travel work");
    expect(normalizeLabelName("Cafe\u0301")).toBe(normalizeLabelName("Caf\u00e9"));
    expect(normalizeLabelName("travel-work")).not.toBe(normalizeLabelName("travel work"));
  });

  it("keeps Category and Money Space as distinct kinds", async () => {
    const category = await labels.createCategory(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      kind: "expense",
      name: "Project",
    });
    const space = await labels.createMoneySpace(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      name: "Project",
    });
    expect(category).toHaveProperty("kind", "expense");
    expect(space).not.toHaveProperty("kind");
    await expect(
      labels.renameMoneySpace(ACCOUNT_A, category.id, {
        expectedRevision: category.revision,
        name: "Wrong kind",
      }),
    ).rejects.toMatchObject({ code: "LABEL_KIND_MISMATCH" });
  });

  it("scopes active normalized uniqueness by account and category kind", async () => {
    await labels.createCategory(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      kind: "expense",
      name: "  HEALTH  ",
    });
    await expect(
      labels.createCategory(ACCOUNT_A, {
        idempotencyKey: randomUUID(),
        kind: "expense",
        name: "health",
      }),
    ).rejects.toMatchObject({ code: "LABEL_CONFLICT" });
    await expect(
      labels.createCategory(ACCOUNT_A, {
        idempotencyKey: randomUUID(),
        kind: "income",
        name: "health",
      }),
    ).resolves.toMatchObject({ kind: "income" });
    await expect(
      labels.createCategory(ACCOUNT_B, {
        idempotencyKey: randomUUID(),
        kind: "expense",
        name: "health",
      }),
    ).resolves.toMatchObject({ name: "health" });
  });

  it("rejects stale rename, deactivate, and restore without last-write-wins", async () => {
    const created = await labels.createCategory(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      kind: "expense",
      name: "Revisioned",
    });
    const renamed = await labels.renameCategory(ACCOUNT_A, created.id, {
      expectedRevision: created.revision,
      name: "Revisioned two",
    });
    await expect(
      labels.renameCategory(ACCOUNT_A, created.id, {
        expectedRevision: created.revision,
        name: "Stale rename",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const inactive = await labels.deactivateCategory(ACCOUNT_A, created.id, renamed.revision);
    await expect(
      labels.deactivateCategory(ACCOUNT_A, created.id, renamed.revision),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const restored = await labels.restoreCategory(ACCOUNT_A, created.id, inactive.revision);
    await expect(
      labels.restoreCategory(ACCOUNT_A, created.id, inactive.revision),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(restored.status).toBe("active");
  });

  it("preserves referenced Money Memos when a label is deactivated", async () => {
    const category = await labels.createCategory(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      kind: "expense",
      name: "Historical",
    });
    const memoId = randomUUID();
    await adminPool.query(
      `INSERT INTO money_memos (
         id, user_id, direction, amount_minor, currency_code, currency_exponent,
         currency_registry_version, occurred_at, occurred_local, occurred_timezone,
         occurred_offset_minutes, timezone_database_version, category_id, origin,
         lifecycle_state, revision
       ) VALUES ($1, $2, 'expense', 100, 'USD', 2, 'test-v1', now(),
         timestamp '2026-01-01 00:00:00', 'UTC', 0, 'test-tzdb', $3, 'manual', 'active', 1)`,
      [memoId, ACCOUNT_A, category.id],
    );
    const inactive = await labels.deactivateCategory(ACCOUNT_A, category.id, category.revision);
    const retained = await adminPool.query<{ category_id: string; name: string; status: string }>(
      `SELECT m.category_id, c.name, c.status
       FROM money_memos m JOIN categories c ON c.id = m.category_id AND c.user_id = m.user_id
       WHERE m.id = $1`,
      [memoId],
    );
    expect(inactive.status).toBe("inactive");
    expect(retained.rows[0]).toMatchObject({
      category_id: category.id,
      name: "Historical",
      status: "inactive",
    });
  });

  it("rejects restore when another active normalized name now exists", async () => {
    const first = await labels.createMoneySpace(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      name: "Travel restore",
    });
    const inactive = await labels.deactivateMoneySpace(ACCOUNT_A, first.id, first.revision);
    await labels.createMoneySpace(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      name: " travel   restore ",
    });
    await expect(
      labels.restoreMoneySpace(ACCOUNT_A, first.id, inactive.revision),
    ).rejects.toMatchObject({ code: "LABEL_CONFLICT" });
  });

  it("derives ownership only from authenticated account and hides cross-account labels", async () => {
    const ownedByA = await labels.createMoneySpace(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      name: "Private context",
    });
    await expect(
      labels.renameMoneySpace(ACCOUNT_B, ownedByA.id, {
        expectedRevision: ownedByA.revision,
        name: "Cross account attempt",
      }),
    ).rejects.toMatchObject({ code: "LABEL_NOT_FOUND" });
    const accountBLabels = await labels.listMoneySpaces(ACCOUNT_B, { status: "all" });
    expect(accountBLabels.map((label) => label.id)).not.toContain(ownedByA.id);
  });

  it("contains no financial-account semantics in label representations", async () => {
    const space = await labels.createMoneySpace(ACCOUNT_B, {
      idempotencyKey: randomUUID(),
      name: "Household",
    });
    expect(Object.keys(space).sort()).toEqual(["id", "name", "origin", "revision", "status"]);
    expect(space).not.toHaveProperty("balance");
    expect(space).not.toHaveProperty("accountNumber");
    expect(space).not.toHaveProperty("institution");
    expect(space).not.toHaveProperty("paymentSource");
  });

  it("uses stable typed service errors", () => {
    expect(new LabelServiceError("REVISION_CONFLICT")).toMatchObject({
      code: "REVISION_CONFLICT",
      message: "REVISION_CONFLICT",
    });
  });
});
