import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FinitePrivacyBoundary } from "@cashmemo/privacy-rules";

import { ConfirmDraftService } from "../../src/modules/assisted-capture/confirm-draft.service.js";
import { createDraft } from "../../src/modules/draft/draft.service.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000143";
const OTHER = "00000000-0000-4000-8000-000000000144";
const CATEGORY = "10000000-0000-4000-8000-000000000143";
const SPACE = "20000000-0000-4000-8000-000000000143";
const HMAC = Buffer.from("synthetic-confirmation-hmac-key-32-bytes");
const memo = {
  categoryId: CATEGORY,
  direction: "expense" as const,
  money: { amount: "12.50", currency: "USD" },
  moneySpaceId: SPACE,
  note: "synthetic reviewed note",
  occurrence: {
    occurredAt: "2026-08-11T10:00:00Z",
    occurredLocal: "2026-08-11T10:00:00",
    occurredOffsetMinutes: 0,
    occurredTimezone: "UTC",
    timezoneDatabaseVersion: "2025b",
  },
  planningStatus: "unplanned" as const,
  purpose: "personal" as const,
};

describe("assisted draft confirmation", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;
  let service: ConfirmDraftService;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL missing");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'confirm-owner@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'confirm-other@cashmemo.test', true, 'active')`,
      [ACCOUNT, OTHER],
    );
    await admin.query(`INSERT INTO history_list_states (user_id) VALUES ($1), ($2)`, [
      ACCOUNT,
      OTHER,
    ]);
    await admin.query(
      `INSERT INTO categories (id, user_id, kind, name, normalized_name)
       VALUES ($1, $2, 'expense', 'Synthetic', 'synthetic')`,
      [CATEGORY, ACCOUNT],
    );
    await admin.query(
      `INSERT INTO money_spaces (id, user_id, name, normalized_name)
       VALUES ($1, $2, 'Context', 'context')`,
      [SPACE, ACCOUNT],
    );
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
    service = new ConfirmDraftService({
      hmacKey: HMAC,
      pool: runtime,
      privacy: new FinitePrivacyBoundary(),
    });
  }, 120_000);

  beforeEach(async () => {
    await admin.query("DELETE FROM background_jobs");
    await admin.query("DELETE FROM idempotency_records");
    await admin.query("DELETE FROM assisted_captures");
    await admin.query("DELETE FROM compose_drafts");
    await admin.query("DELETE FROM money_memos");
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  async function draft(account = ACCOUNT) {
    return createDraft(runtime, account, {
      candidateFields: { amount: "12.50" },
      captureStartedAt: "2026-08-11T09:00:00Z",
      captureTimezone: "UTC",
      origin: "natural_language",
      sourceCompleteness: "complete",
      sourceText: "synthetic source",
      status: "reviewable",
    });
  }

  type MemoOverrides = Omit<Partial<typeof memo>, "categoryId" | "moneySpaceId"> & {
    categoryId?: string | null;
    moneySpaceId?: string | null;
  };
  const input = (revision: string, overrides: MemoOverrides = {}) => ({
    confirmation: "CONFIRM_MONEY_MEMO" as const,
    expectedRevision: revision,
    memo: { ...memo, ...overrides },
  });

  it("creates exactly one authoritative memo only after explicit confirmation", async () => {
    const current = await draft();
    const result = await service.confirm(
      ACCOUNT,
      current.id,
      crypto.randomUUID(),
      input(current.revision),
    );
    expect(result).toMatchObject({ origin: "natural_language", revision: "1" });
    expect((await admin.query("SELECT count(*)::int AS count FROM money_memos")).rows[0]).toEqual({
      count: 1,
    });
  });

  it("replays the same idempotency key without a second memo", async () => {
    const current = await draft();
    const key = crypto.randomUUID();
    const request = input(current.revision);
    const first = await service.confirm(ACCOUNT, current.id, key, request);
    const second = await service.confirm(ACCOUNT, current.id, key, request);
    expect(second.id).toBe(first.id);
    expect((await admin.query("SELECT count(*)::int AS count FROM money_memos")).rows[0]).toEqual({
      count: 1,
    });
  });

  it("rejects changed payload under the same idempotency key", async () => {
    const current = await draft();
    const key = crypto.randomUUID();
    await service.confirm(ACCOUNT, current.id, key, input(current.revision));
    await expect(
      service.confirm(ACCOUNT, current.id, key, input(current.revision, { note: "changed" })),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects stale draft revision without memo creation", async () => {
    const current = await draft();
    await expect(
      service.confirm(ACCOUNT, current.id, crypto.randomUUID(), input("0")),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await admin.query("SELECT count(*)::int AS count FROM money_memos")).rows[0]).toEqual({
      count: 0,
    });
  });

  it("rejects expired drafts", async () => {
    const current = await draft();
    await admin.query(
      `UPDATE compose_drafts SET last_activity_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1`,
      [current.id],
    );
    await expect(
      service.confirm(ACCOUNT, current.id, crypto.randomUUID(), input(current.revision)),
    ).rejects.toMatchObject({ code: "DRAFT_EXPIRED" });
  });

  it("rejects prohibited final note before financial persistence", async () => {
    const current = await draft();
    await expect(
      service.confirm(
        ACCOUNT,
        current.id,
        crypto.randomUUID(),
        input(current.revision, { note: "CVV: 123" }),
      ),
    ).rejects.toMatchObject({ code: "PRIVACY_BOUNDARY_BLOCKED" });
    expect((await admin.query("SELECT count(*)::int AS count FROM money_memos")).rows[0]).toEqual({
      count: 0,
    });
  });

  it("rejects cross-account draft access without disclosure", async () => {
    const current = await draft();
    await expect(
      service.confirm(
        OTHER,
        current.id,
        crypto.randomUUID(),
        input(current.revision, { categoryId: null, moneySpaceId: null }),
      ),
    ).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
  });

  it("revalidates label ownership and kind at confirmation", async () => {
    const current = await draft();
    await expect(
      service.confirm(
        ACCOUNT,
        current.id,
        crypto.randomUUID(),
        input(current.revision, { categoryId: "10000000-0000-4000-8000-000000000999" }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("prevents a second confirmation and schedules content-free cleanup", async () => {
    const current = await draft();
    await service.confirm(ACCOUNT, current.id, crypto.randomUUID(), input(current.revision));
    await expect(
      service.confirm(ACCOUNT, current.id, crypto.randomUUID(), input(current.revision)),
    ).rejects.toMatchObject({ code: "DRAFT_ALREADY_CONFIRMED" });
    expect(
      (
        await admin.query(
          "SELECT source_text, candidate_fields FROM compose_drafts WHERE id = $1",
          [current.id],
        )
      ).rows[0],
    ).toEqual({ source_text: null, candidate_fields: {} });
    expect((await admin.query("SELECT count(*)::int AS count FROM money_memos")).rows[0]).toEqual({
      count: 1,
    });
  });
});
