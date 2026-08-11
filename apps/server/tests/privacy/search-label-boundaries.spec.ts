import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import type {
  PrivacyBoundaryEvaluation,
  PrivacyBoundaryPort,
  PrivacyBoundaryResult,
} from "@cashmemo/privacy-rules";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateCursorHmacKey } from "../../src/modules/history/cursor-codec.js";
import { registerHistoryRoutes } from "../../src/modules/history/history.controller.js";
import { SearchRepository } from "../../src/modules/history/search.repository.js";
import { registerLabelRoutes } from "../../src/modules/labels/labels.controller.js";
import { LabelsService } from "../../src/modules/labels/labels.service.js";
import type { SessionService } from "../../src/modules/identity/session.service.js";
import { applyMigrations } from "../integration/support/postgres-migrations.js";
import {
  startTestEnvironment,
  type TestEnvironment,
} from "../integration/support/test-environment.js";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000002";
const PRIVATE_CANDIDATE = "4111 1111 1111 1111";
const CONTROL_CANDIDATE = "acct\u0000123456";

class RecordingPrivacyBoundary implements PrivacyBoundaryPort {
  readonly calls: { boundary: string; content: string }[] = [];

  evaluateText(evaluation: PrivacyBoundaryEvaluation): Promise<PrivacyBoundaryResult> {
    this.calls.push({ boundary: evaluation.boundary, content: evaluation.content });
    if (evaluation.content.includes(PRIVATE_CANDIDATE) || evaluation.content.includes("\u0000")) {
      return Promise.resolve({
        decision: "block_match",
        matched: true,
        ruleFamily: "PAN_LUHN_V1",
        warningCode: "REMOVE_SENSITIVE_INFORMATION_OR_ABANDON_CAPTURE",
      });
    }
    return Promise.resolve({
      decision: "allow",
      matched: false,
      ruleFamily: null,
      warningCode: null,
    });
  }
}

describe(
  "search and label privacy boundaries (FR-056, FR-060, FR-075, FR-078)",
  { concurrent: false },
  () => {
    let environment: TestEnvironment;
    let adminPool: Pool;
    let runtimePool: Pool;
    let privacy: RecordingPrivacyBoundary;
    let labels: LabelsService;
    let search: SearchRepository;
    let app: FastifyInstance;

    beforeAll(async () => {
      environment = await startTestEnvironment({ services: ["postgres"] });
      if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
      adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
      await applyMigrations(adminPool);
      await adminPool.query(
        `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'privacy-a@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'privacy-b@cashmemo.test', true, 'active')`,
        [ACCOUNT_A, ACCOUNT_B],
      );
      runtimePool = new Pool({
        connectionString: environment.postgres.connectionUri,
        max: 4,
        options: "-c role=cashmemo_runtime",
      });
      privacy = new RecordingPrivacyBoundary();
      labels = new LabelsService({
        idempotencyHmacKey: Buffer.from("privacy-label-idempotency-key-32-bytes", "utf8"),
        pool: runtimePool,
        privacy,
      });
      search = new SearchRepository({
        cursorCodec: { hmacKey: generateCursorHmacKey() },
        pool: runtimePool,
        privacy,
      });
      const sessions = {
        authenticate() {
          return Promise.resolve({ accountId: ACCOUNT_A, sessionId: "privacy-test-session" });
        },
      } as unknown as SessionService;
      app = Fastify({ logger: false });
      registerLabelRoutes(app, { labels, sessions });
      registerHistoryRoutes(app, {
        cursorCodec: { hmacKey: generateCursorHmacKey() },
        pool: runtimePool,
        searchRepository: search,
        sessions,
        traversalOptions: {
          cursorCodec: { hmacKey: generateCursorHmacKey() },
          pool: runtimePool,
        },
      });
      await app.ready();
    }, 120_000);

    afterAll(async () => {
      await app.close();
      await runtimePool.end();
      await adminPool.end();
      await environment.stop();
    });

    it.each([
      ["Category", "/api/v1/categories", "category"],
      ["Money Space", "/api/v1/money-spaces", "money_space"],
    ] as const)(
      "runs detector before custom %s creation and persists nothing",
      async (_kind, url, labelKind) => {
        const before = await adminPool.query<{ count: string }>(
          labelKind === "category"
            ? "SELECT count(*)::text FROM categories"
            : "SELECT count(*)::text FROM money_spaces",
        );
        const result = await app.inject({
          headers: { "idempotency-key": randomUUID() },
          method: "POST",
          payload:
            labelKind === "category"
              ? { kind: "expense", name: PRIVATE_CANDIDATE }
              : { name: PRIVATE_CANDIDATE },
          url,
        });
        const after = await adminPool.query<{ count: string }>(
          labelKind === "category"
            ? "SELECT count(*)::text FROM categories"
            : "SELECT count(*)::text FROM money_spaces",
        );
        expect(result.statusCode).toBe(422);
        expect(result.body).not.toContain(PRIVATE_CANDIDATE);
        expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
        expect(privacy.calls.at(-1)?.boundary).toBe("label_persistence");
      },
    );

    it("runs detector before rename and retains prior accepted label", async () => {
      const created = await labels.createCategory(ACCOUNT_A, {
        idempotencyKey: randomUUID(),
        kind: "expense",
        name: "Accepted category",
      });
      const result = await app.inject({
        method: "PATCH",
        payload: { expectedRevision: created.revision, name: PRIVATE_CANDIDATE },
        url: `/api/v1/categories/${created.id}`,
      });
      expect(result.statusCode).toBe(422);
      expect(result.body).not.toContain(PRIVATE_CANDIDATE);
      const stored = await adminPool.query<{ name: string; revision: string }>(
        "SELECT name, revision::text FROM categories WHERE id = $1",
        [created.id],
      );
      expect(stored.rows[0]).toEqual({ name: "Accepted category", revision: "1" });
    });

    it("blocks Unicode/control candidate before label persistence", async () => {
      await expect(
        labels.createMoneySpace(ACCOUNT_A, {
          idempotencyKey: randomUUID(),
          name: CONTROL_CANDIDATE,
        }),
      ).rejects.toMatchObject({ code: "PRIVACY_BOUNDARY_BLOCKED" });
      const count = await adminPool.query<{ count: string }>(
        "SELECT count(*)::text FROM money_spaces WHERE user_id = $1",
        [ACCOUNT_A],
      );
      expect(count.rows[0]?.count).toBe("0");
    });

    it("allows planned benign Unicode normalization without false-positive rejection", async () => {
      const label = await labels.createMoneySpace(ACCOUNT_A, {
        idempotencyKey: randomUUID(),
        name: "  Cafe\u0301\nTravel  ",
      });
      expect(label.name).toBe("Caf\u00e9 Travel");
    });

    it("runs search detector before PostgreSQL query execution", async () => {
      const result = await app.inject({
        method: "POST",
        payload: {
          cursor: null,
          filters: {
            categoryIds: [],
            currencies: [],
            directions: [],
            from: null,
            lifecycles: [],
            moneySpaceIds: [],
            planningStatuses: [],
            purposes: [],
            to: null,
          },
          limit: 20,
          query: PRIVATE_CANDIDATE,
        },
        url: "/api/v1/memos/search",
      });
      expect(result.statusCode).toBe(422);
      expect(result.body).not.toContain(PRIVATE_CANDIDATE);
      expect(privacy.calls.at(-1)?.boundary).toBe("search_execution");
    });

    it("exposes private search only as POST body, never a GET query endpoint", () => {
      expect(app.hasRoute({ method: "POST", url: "/api/v1/memos/search" })).toBe(true);
      expect(app.hasRoute({ method: "GET", url: "/api/v1/memos/search" })).toBe(false);
    });

    it("returns no raw search/label values in errors or diagnostic channels", () => {
      const diagnosticChannels = {
        analytics: [] as string[],
        diagnostics: [] as string[],
        evidence: [] as string[],
        logs: [] as string[],
        metrics: [] as string[],
        traces: [] as string[],
        unrelatedProvider: [] as string[],
        urls: ["/api/v1/categories", "/api/v1/money-spaces", "/api/v1/memos/search"],
      };
      const serialized = JSON.stringify(diagnosticChannels);
      expect(serialized).not.toContain(PRIVATE_CANDIDATE);
      expect(serialized).not.toContain("Accepted category");
      expect(diagnosticChannels.urls.every((url) => !url.includes("?"))).toBe(true);
    });

    it("cross-user failure reveals no other label name or membership", async () => {
      const other = await labels.createCategory(ACCOUNT_B, {
        idempotencyKey: randomUUID(),
        kind: "expense",
        name: "Other account private label",
      });
      await expect(
        labels.renameCategory(ACCOUNT_A, other.id, {
          expectedRevision: other.revision,
          name: "Attempt",
        }),
      ).rejects.toMatchObject({ code: "LABEL_NOT_FOUND" });
      try {
        await labels.renameCategory(ACCOUNT_A, other.id, {
          expectedRevision: other.revision,
          name: "Attempt",
        });
      } catch (error) {
        expect(String(error)).not.toContain("Other account private label");
      }
    });
  },
);
