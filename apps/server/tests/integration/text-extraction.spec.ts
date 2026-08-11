/* eslint-disable @typescript-eslint/require-await */
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FinitePrivacyBoundary } from "@cashmemo/privacy-rules";

import { DeterministicExtractionAdapter } from "../../src/adapters/fakes/assisted-provider.adapters.js";
import type { ExtractionPort } from "../../src/modules/assisted-capture/provider-ports.js";
import {
  TextExtractionError,
  TextExtractionService,
} from "../../src/modules/assisted-capture/text-extraction.service.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000125";
const CATEGORY = "10000000-0000-4000-8000-000000000125";
const SPACE = "20000000-0000-4000-8000-000000000125";
const CAPTURE_STARTED = "2026-08-11T10:00:00Z";
const safeInput = {
  captureStartedAt: CAPTURE_STARTED,
  captureTimezone: "Asia/Jakarta",
  consent: "SEND_THIS_TEXT_FOR_AI_EXTRACTION" as const,
  text: "Synthetic lunch yesterday for twelve dollars",
};

describe("typed natural-language extraction", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;
  let runtimePool: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status)
       VALUES ($1, 'Cashmemo account', 'typed-extraction@cashmemo.test', true, 'active')`,
      [ACCOUNT],
    );
    await adminPool.query(
      `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
       VALUES ($1, 'USD', 'Asia/Jakarta', 'en-US')`,
      [ACCOUNT],
    );
    await adminPool.query(
      `INSERT INTO categories (id, user_id, kind, name, normalized_name)
       VALUES ($1, $2, 'expense', 'Synthetic expense', 'synthetic expense')`,
      [CATEGORY, ACCOUNT],
    );
    await adminPool.query(
      `INSERT INTO money_spaces (id, user_id, name, normalized_name)
       VALUES ($1, $2, 'Synthetic context', 'synthetic context')`,
      [SPACE, ACCOUNT],
    );
    runtimePool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  beforeEach(async () => {
    await adminPool.query("DELETE FROM assisted_captures WHERE user_id = $1", [ACCOUNT]);
    await adminPool.query("DELETE FROM compose_drafts WHERE user_id = $1", [ACCOUNT]);
    await adminPool.query("DELETE FROM money_memos WHERE user_id = $1", [ACCOUNT]);
  });

  afterAll(async () => {
    await runtimePool.end();
    await adminPool.end();
    await environment.stop();
  });

  function service(extraction: ExtractionPort) {
    return new TextExtractionService({
      extraction,
      now: () => new Date("2026-08-11T12:00:00Z"),
      pool: runtimePool,
      privacy: new FinitePrivacyBoundary(),
    });
  }

  it("creates only a reviewable non-authoritative draft and preserves exact allowed bytes", async () => {
    const result = await service(
      new DeterministicExtractionAdapter({
        fields: {
          amount: "12.00",
          categoryId: CATEGORY,
          currency: "USD",
          direction: "expense",
          moneySpaceId: SPACE,
          occurredLocal: "2026-08-10T12:00:00",
          occurredOffsetMinutes: 420,
          occurredTimezone: "Asia/Jakarta",
          planningStatus: "unplanned",
          purpose: "personal",
        },
        mode: "success",
      }),
    ).extract(ACCOUNT, safeInput);
    expect(result.state).toBe("draft_review");
    expect(result.draft).toMatchObject({
      authoritative: false,
      captureStartedAt: "2026-08-11T10:00:00.000Z",
      captureTimezone: "Asia/Jakarta",
      sourceText: safeInput.text,
      status: "reviewable",
    });
    expect(Buffer.from(result.draft.sourceText ?? "")).toEqual(Buffer.from(safeInput.text));
    expect(
      (await adminPool.query("SELECT count(*)::int AS count FROM money_memos")).rows[0],
    ).toEqual({ count: 0 });
  });

  it("passes immutable relative-time anchor and timezone to provider request", async () => {
    let observed: { captureStartedAt: string; captureTimezone: string } | null = null;
    const extraction: ExtractionPort = {
      extract: async (request) => {
        observed = {
          captureStartedAt: request.captureStartedAt,
          captureTimezone: request.captureTimezone,
        };
        return { assessments: [], fields: {}, state: "success" };
      },
    };
    await service(extraction).extract(ACCOUNT, safeInput);
    expect(observed).toEqual({
      captureStartedAt: CAPTURE_STARTED,
      captureTimezone: "Asia/Jakarta",
    });
  });

  it("blocks prohibited input before provider call or persistence", async () => {
    const extraction = new DeterministicExtractionAdapter({ mode: "success" });
    await expect(
      service(extraction).extract(ACCOUNT, {
        ...safeInput,
        text: "CVV: 123",
      }),
    ).rejects.toMatchObject({ code: "PRIVACY_BOUNDARY_BLOCKED" });
    expect(extraction.calls).toEqual([]);
    expect(
      (await adminPool.query("SELECT count(*)::int AS count FROM compose_drafts")).rows[0],
    ).toEqual({ count: 0 });
  });

  it("requires explicit operation consent before provider call", async () => {
    const extraction = new DeterministicExtractionAdapter({ mode: "success" });
    await expect(
      service(extraction).extract(ACCOUNT, { ...safeInput, consent: "wrong" }),
    ).rejects.toBeInstanceOf(TextExtractionError);
    expect(extraction.calls).toEqual([]);
  });

  it("keeps ambiguous output as correction state", async () => {
    const result = await service(
      new DeterministicExtractionAdapter({
        assessments: [
          {
            field: "amount",
            reasonCode: "AMBIGUOUS_AMOUNT",
            source: "ai",
            status: "uncertain",
          },
        ],
        fields: { amount: null, currency: null, direction: "expense" },
        mode: "ambiguous",
      }),
    ).extract(ACCOUNT, safeInput);
    expect(result.state).toBe("correction_required");
    expect(result.draft.authoritative).toBe(false);
  });

  it.each([
    ["invalid schema", new DeterministicExtractionAdapter({ mode: "invalid_schema" })],
    [
      "unsupported currency",
      new DeterministicExtractionAdapter({
        fields: { amount: "1.00", currency: "ZZZ", direction: "expense" },
        mode: "success",
      }),
    ],
    [
      "invalid amount",
      new DeterministicExtractionAdapter({
        fields: { amount: "-1", currency: "USD", direction: "expense" },
        mode: "success",
      }),
    ],
    [
      "cross-account category",
      new DeterministicExtractionAdapter({
        fields: { categoryId: "10000000-0000-4000-8000-000000000999", direction: "expense" },
        mode: "success",
      }),
    ],
  ] as const)("rejects %s into recoverable correction/failure state", async (_name, extraction) => {
    const result = await service(extraction).extract(ACCOUNT, safeInput);
    expect(["correction_required", "failed_recoverable"]).toContain(result.state);
    expect(
      (await adminPool.query("SELECT count(*)::int AS count FROM money_memos")).rows[0],
    ).toEqual({ count: 0 });
  });

  it("rejects unexpected provider fields without coercion", async () => {
    const extraction: ExtractionPort = {
      extract: async () =>
        ({
          assessments: [],
          fields: { amount: "1.00", currency: "USD", direction: "expense", unsupported: true },
          state: "success",
        }) as never,
    };
    const result = await service(extraction).extract(ACCOUNT, safeInput);
    expect(result.state).toBe("correction_required");
    expect(result.draft.fields).toEqual({});
  });

  it.each(["timeout", "rate_limit"] as const)("bounds retries for %s", async (mode) => {
    const extraction = new DeterministicExtractionAdapter({ mode });
    const result = await service(extraction).extract(ACCOUNT, safeInput);
    expect(extraction.calls).toHaveLength(2);
    expect(result.state).toBe("failed_recoverable");
    expect(
      (await adminPool.query("SELECT count(*)::int AS count FROM money_memos")).rows[0],
    ).toEqual({ count: 0 });
  });
});
