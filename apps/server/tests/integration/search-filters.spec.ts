import { randomUUID } from "node:crypto";

import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateCursorHmacKey } from "../../src/modules/history/cursor-codec.js";
import { TraversalError } from "../../src/modules/history/versioned-traversal.service.js";
import {
  SearchRepository,
  type SearchFilters,
  type SearchRequest,
} from "../../src/modules/history/search.repository.js";
import { LabelsService } from "../../src/modules/labels/labels.service.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000002";
const CATEGORY_FOOD = "10000000-0000-4000-8000-000000000001";
const CATEGORY_WORK = "10000000-0000-4000-8000-000000000002";
const SPACE_PERSONAL = "20000000-0000-4000-8000-000000000001";
const SPACE_PROJECT = "20000000-0000-4000-8000-000000000002";

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

const emptyFilters: SearchFilters = {
  categoryIds: [],
  currencies: [],
  directions: [],
  from: null,
  lifecycles: [],
  moneySpaceIds: [],
  planningStatuses: [],
  purposes: [],
  to: null,
};

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    cursor: null,
    filters: emptyFilters,
    limit: 50,
    query: null,
    ...overrides,
  };
}

describe(
  "account-first search and intersection filters (FR-056–FR-060)",
  { concurrent: false },
  () => {
    let environment: TestEnvironment;
    let adminPool: Pool;
    let runtimePool: Pool;
    let repository: SearchRepository;

    beforeAll(async () => {
      environment = await startTestEnvironment({ services: ["postgres"] });
      if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
      adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
      await applyMigrations(adminPool);
      await adminPool.query(
        `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'search-a@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'search-b@cashmemo.test', true, 'active')`,
        [ACCOUNT_A, ACCOUNT_B],
      );
      await adminPool.query(
        `INSERT INTO categories (id, user_id, kind, name, normalized_name) VALUES
       ($1, $3, 'expense', 'Food context', 'food context'),
       ($2, $3, 'income', 'Work context', 'work context')`,
        [CATEGORY_FOOD, CATEGORY_WORK, ACCOUNT_A],
      );
      await adminPool.query(
        `INSERT INTO money_spaces (id, user_id, name, normalized_name) VALUES
       ($1, $3, 'Personal context', 'personal context'),
       ($2, $3, 'Project context', 'project context')`,
        [SPACE_PERSONAL, SPACE_PROJECT, ACCOUNT_A],
      );

      const rows = [
        [
          "2026-06-10T10:00:00.000Z",
          "expense",
          "USD",
          CATEGORY_FOOD,
          SPACE_PERSONAL,
          "personal",
          "planned",
          "active",
          "alpha groceries",
        ],
        [
          "2026-06-09T10:00:00.000Z",
          "expense",
          "IDR",
          CATEGORY_FOOD,
          SPACE_PROJECT,
          "work",
          "unplanned",
          "archived",
          "alpha project",
        ],
        [
          "2026-06-08T10:00:00.000Z",
          "income",
          "USD",
          CATEGORY_WORK,
          SPACE_PROJECT,
          "work",
          "planned",
          "active",
          "client alpha",
        ],
        [
          "2026-06-07T10:00:00.000Z",
          "expense",
          "USD",
          null,
          null,
          null,
          null,
          "active",
          "uncategorized alpha",
        ],
        [
          "2026-06-06T10:00:00.000Z",
          "expense",
          "USD",
          CATEGORY_FOOD,
          SPACE_PERSONAL,
          "personal",
          "planned",
          "active",
          "alpha groceries repeat",
        ],
        [
          "2026-06-05T10:00:00.000Z",
          "expense",
          "USD",
          CATEGORY_FOOD,
          SPACE_PERSONAL,
          "personal",
          "planned",
          "active",
          "alpha groceries older",
        ],
        [
          "2026-06-04T10:00:00.000Z",
          "expense",
          "USD",
          CATEGORY_FOOD,
          SPACE_PERSONAL,
          "personal",
          "planned",
          "recently_deleted",
          "alpha removed",
        ],
        [
          "2026-06-03T10:00:00.000Z",
          "expense",
          "USD",
          CATEGORY_FOOD,
          SPACE_PERSONAL,
          "personal",
          "planned",
          "purging",
          "alpha purged",
        ],
      ] as const;

      for (const [
        occurredAt,
        direction,
        currency,
        categoryId,
        spaceId,
        purpose,
        planning,
        lifecycle,
        note,
      ] of rows) {
        await adminPool.query(
          `INSERT INTO money_memos (
           id, user_id, direction, amount_minor, currency_code, currency_exponent,
           currency_registry_version, occurred_at, occurred_local, occurred_timezone,
           occurred_offset_minutes, timezone_database_version, category_id, money_space_id,
           purpose, planning_status, note, origin, lifecycle_state, prior_lifecycle_state,
           deleted_at, purge_after, revision
         ) VALUES (
           $1, $2, $3, 100, $4, 2, 'test-v1', $5, timestamp '2026-06-01 00:00:00',
           'UTC', 0, 'test-tzdb', $6, $7, $8, $9, $10,
           'manual', $11::text::memo_lifecycle_state,
           CASE WHEN $11::text IN ('recently_deleted', 'purging') THEN 'active'::memo_prior_lifecycle_state ELSE NULL END,
           CASE WHEN $11::text IN ('recently_deleted', 'purging') THEN now() ELSE NULL END,
           CASE WHEN $11::text IN ('recently_deleted', 'purging') THEN now() + interval '30 days' ELSE NULL END,
           1
         )`,
          [
            randomUUID(),
            ACCOUNT_A,
            direction,
            currency,
            occurredAt,
            categoryId,
            spaceId,
            purpose,
            planning,
            note,
            lifecycle,
          ],
        );
      }
      await adminPool.query(
        `INSERT INTO money_memos (
         id, user_id, direction, amount_minor, currency_code, currency_exponent,
         currency_registry_version, occurred_at, occurred_local, occurred_timezone,
         occurred_offset_minutes, timezone_database_version, note, origin, lifecycle_state, revision
       ) VALUES ($1, $2, 'expense', 100, 'USD', 2, 'test-v1', '2026-06-11T10:00:00Z',
         timestamp '2026-06-11 10:00:00', 'UTC', 0, 'test-tzdb', 'alpha other account',
         'manual', 'active', 1)`,
        [randomUUID(), ACCOUNT_B],
      );
      await adminPool.query(
        `INSERT INTO history_list_states (user_id, version) VALUES ($1, 1), ($2, 1)`,
        [ACCOUNT_A, ACCOUNT_B],
      );

      runtimePool = new Pool({
        connectionString: environment.postgres.connectionUri,
        max: 4,
        options: "-c role=cashmemo_runtime",
      });
      repository = new SearchRepository({
        cursorCodec: { hmacKey: generateCursorHmacKey() },
        pool: runtimePool,
        privacy: allowPrivacy,
      });
    }, 120_000);

    afterAll(async () => {
      await runtimePool.end();
      await adminPool.end();
      await environment.stop();
    });

    it("returns only exact account-owned text matches", async () => {
      const page = await repository.search(ACCOUNT_A, request({ query: "alpha" }));
      expect(page.items).not.toHaveLength(0);
      expect(page.items.some((item) => item.note === "alpha other account")).toBe(false);
    });

    it("searches current Category and Money Space names through the projection", async () => {
      const category = await repository.search(ACCOUNT_A, request({ query: "Food context" }));
      expect(category.items.every((item) => item.categoryId === CATEGORY_FOOD)).toBe(true);
      const space = await repository.search(ACCOUNT_A, request({ query: "Project context" }));
      expect(space.items.every((item) => item.moneySpaceId === SPACE_PROJECT)).toBe(true);
    });

    it("combines every provided criterion by intersection", async () => {
      const page = await repository.search(
        ACCOUNT_A,
        request({
          filters: {
            categoryIds: [CATEGORY_FOOD],
            currencies: ["USD"],
            directions: ["expense"],
            from: "2026-06-05T00:00:00.000Z",
            lifecycles: ["active"],
            moneySpaceIds: [SPACE_PERSONAL],
            planningStatuses: ["planned"],
            purposes: ["personal"],
            to: "2026-06-11T00:00:00.000Z",
          },
          query: "groceries",
        }),
      );
      expect(page.items).toHaveLength(3);
      expect(
        page.items.every(
          (item) =>
            item.categoryId === CATEGORY_FOOD &&
            item.currencyCode === "USD" &&
            item.direction === "expense" &&
            item.lifecycleState === "active" &&
            item.moneySpaceId === SPACE_PERSONAL &&
            item.planningStatus === "planned" &&
            item.purpose === "personal",
        ),
      ).toBe(true);
    });

    it.each([
      [
        "date",
        { ...emptyFilters, from: "2026-06-09T00:00:00.000Z", to: "2026-06-10T23:59:59.999Z" },
        2,
      ],
      ["direction", { ...emptyFilters, directions: ["income"] }, 1],
      ["category", { ...emptyFilters, categoryIds: [CATEGORY_WORK] }, 1],
      ["money space", { ...emptyFilters, moneySpaceIds: [SPACE_PROJECT] }, 2],
      ["purpose", { ...emptyFilters, purposes: ["work"] }, 2],
      ["planned", { ...emptyFilters, planningStatuses: ["planned"] }, 4],
      ["currency", { ...emptyFilters, currencies: ["IDR"] }, 1],
      ["lifecycle", { ...emptyFilters, lifecycles: ["archived"] }, 1],
    ] as const)("filters by %s metadata", async (_name, filters, expected) => {
      const page = await repository.search(ACCOUNT_A, request({ filters }));
      expect(page.items).toHaveLength(expected);
    });

    it("supports explicit unspecified purpose and planning values", async () => {
      const page = await repository.search(
        ACCOUNT_A,
        request({
          filters: {
            ...emptyFilters,
            planningStatuses: ["unspecified"],
            purposes: ["unspecified"],
          },
        }),
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ planningStatus: null, purpose: null });
    });

    it("orders deterministically by occurred_at DESC then id DESC", async () => {
      const page = await repository.search(ACCOUNT_A, request());
      const keys = page.items.map((item) => `${item.occurredAt}|${item.id}`);
      expect(keys).toEqual([...keys].sort().reverse());
    });

    it("returns a clear empty page for no match", async () => {
      const page = await repository.search(ACCOUNT_A, request({ query: "no_match_token" }));
      expect(page).toMatchObject({ items: [], nextCursor: null });
    });

    it("rejects malformed and unrecognized criteria before SQL execution", async () => {
      await expect(repository.search(ACCOUNT_A, {})).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      await expect(
        repository.search(ACCOUNT_A, {
          ...request(),
          filters: { ...emptyFilters, lifecycles: ["active' OR true --"] },
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("excludes Recently Deleted and purging rows from normal search", async () => {
      const page = await repository.search(ACCOUNT_A, request({ query: "removed OR purged" }));
      expect(page.items).toEqual([]);
    });

    it("treats currency only as filtering metadata and exposes no conversion", async () => {
      const page = await repository.search(
        ACCOUNT_A,
        request({ filters: { ...emptyFilters, currencies: ["USD"] } }),
      );
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items[0]).not.toHaveProperty("exchangeRate");
      expect(page.items[0]).not.toHaveProperty("convertedAmount");
    });

    it("uses Phase 6 version-bound pagination without duplicates", async () => {
      const first = await repository.search(ACCOUNT_A, request({ limit: 2, query: "alpha" }));
      expect(first.nextCursor).not.toBeNull();
      const second = await repository.search(
        ACCOUNT_A,
        request({ cursor: first.nextCursor, limit: 2, query: "alpha" }),
      );
      const ids = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(second.resultSetVersion).toBe(first.resultSetVersion);
    });

    it("invalidates only the owning account traversal in the label mutation transaction", async () => {
      const labels = new LabelsService({
        idempotencyHmacKey: Buffer.from("search-label-idempotency-key-32-bytes", "utf8"),
        pool: runtimePool,
        privacy: allowPrivacy,
      });
      const accountBVersionBefore = await adminPool.query<{ version: string }>(
        "SELECT version::text FROM history_list_states WHERE user_id = $1",
        [ACCOUNT_B],
      );
      const first = await repository.search(
        ACCOUNT_A,
        request({ limit: 1, query: "Food context" }),
      );
      expect(first.nextCursor).not.toBeNull();
      await labels.renameCategory(ACCOUNT_A, CATEGORY_FOOD, {
        expectedRevision: "1",
        name: "Renamed food context",
      });
      await expect(
        repository.search(
          ACCOUNT_A,
          request({ cursor: first.nextCursor, limit: 1, query: "Food context" }),
        ),
      ).rejects.toBeInstanceOf(TraversalError);
      const accountBVersionAfter = await adminPool.query<{ version: string }>(
        "SELECT version::text FROM history_list_states WHERE user_id = $1",
        [ACCOUNT_B],
      );
      expect(accountBVersionAfter.rows[0]?.version).toBe(accountBVersionBefore.rows[0]?.version);
    });
  },
);
