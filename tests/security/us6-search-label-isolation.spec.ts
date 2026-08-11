import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateCursorHmacKey } from "../../apps/server/src/modules/history/cursor-codec.js";
import { registerHistoryRoutes } from "../../apps/server/src/modules/history/history.controller.js";
import { SearchRepository } from "../../apps/server/src/modules/history/search.repository.js";
import type { SessionService } from "../../apps/server/src/modules/identity/session.service.js";
import { registerLabelRoutes } from "../../apps/server/src/modules/labels/labels.controller.js";
import { LabelsService } from "../../apps/server/src/modules/labels/labels.service.js";
import { applyMigrations } from "../../apps/server/tests/integration/support/postgres-migrations.js";
import {
  startTestEnvironment,
  type TestEnvironment,
} from "../../apps/server/tests/integration/support/test-environment.js";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000002";

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

function headers(accountId: string): Record<string, string> {
  return { "idempotency-key": randomUUID(), "x-test-account": accountId };
}

function searchPayload(overrides: Record<string, unknown> = {}) {
  return {
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
    limit: 1,
    query: null,
    ...overrides,
  };
}

describe("US6 search and label isolation matrix (SC-015)", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;
  let runtimePool: Pool;
  let labels: LabelsService;
  let search: SearchRepository;
  let app: FastifyInstance;
  let categoryA: { id: string; revision: string };
  let categoryB: { id: string; revision: string };
  let spaceA: { id: string; revision: string };

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'security-a@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'security-b@cashmemo.test', true, 'active')`,
      [ACCOUNT_A, ACCOUNT_B],
    );
    runtimePool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_runtime",
    });
    labels = new LabelsService({
      idempotencyHmacKey: Buffer.from("security-label-idempotency-key-32", "utf8"),
      pool: runtimePool,
      privacy: allowPrivacy,
    });
    search = new SearchRepository({
      cursorCodec: { hmacKey: generateCursorHmacKey() },
      pool: runtimePool,
      privacy: allowPrivacy,
    });
    categoryA = await labels.createCategory(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      kind: "expense",
      name: "Account A category",
    });
    categoryB = await labels.createCategory(ACCOUNT_B, {
      idempotencyKey: randomUUID(),
      kind: "expense",
      name: "Account B category",
    });
    spaceA = await labels.createMoneySpace(ACCOUNT_A, {
      idempotencyKey: randomUUID(),
      name: "Account A context",
    });
    for (let index = 0; index < 3; index += 1) {
      await adminPool.query(
        `INSERT INTO money_memos (
           id, user_id, direction, amount_minor, currency_code, currency_exponent,
           currency_registry_version, occurred_at, occurred_local, occurred_timezone,
           occurred_offset_minutes, timezone_database_version, category_id, money_space_id,
           purpose, planning_status, note, origin, lifecycle_state, revision
         ) VALUES ($1, $2, 'expense', 100, 'USD', 2, 'test-v1', $3,
           timestamp '2026-07-01 00:00:00', 'UTC', 0, 'test-tzdb', $4, $5,
           'personal', 'planned', $6, 'manual', 'active', 1)`,
        [
          randomUUID(),
          ACCOUNT_A,
          `2026-07-0${String(index + 1)}T10:00:00Z`,
          categoryA.id,
          spaceA.id,
          `isolation token ${String(index)}`,
        ],
      );
    }
    await adminPool.query(
      `INSERT INTO money_memos (
         id, user_id, direction, amount_minor, currency_code, currency_exponent,
         currency_registry_version, occurred_at, occurred_local, occurred_timezone,
         occurred_offset_minutes, timezone_database_version, category_id, note, origin,
         lifecycle_state, revision
       ) VALUES ($1, $2, 'expense', 100, 'USD', 2, 'test-v1', '2026-07-04T10:00:00Z',
         timestamp '2026-07-04 00:00:00', 'UTC', 0, 'test-tzdb', $3,
         'isolation token other private', 'manual', 'active', 1)`,
      [randomUUID(), ACCOUNT_B, categoryB.id],
    );
    await adminPool.query(
      `INSERT INTO history_list_states (user_id, version) VALUES ($1, 1), ($2, 1)`,
      [ACCOUNT_A, ACCOUNT_B],
    );

    const sessions = {
      authenticate(requestHeaders: Headers) {
        const accountId = requestHeaders.get("x-test-account");
        return Promise.resolve(
          accountId === ACCOUNT_A || accountId === ACCOUNT_B
            ? { accountId, sessionId: "security-session" }
            : null,
        );
      },
    } as unknown as SessionService;
    app = Fastify({ logger: false });
    registerLabelRoutes(app, { labels, sessions });
    registerHistoryRoutes(app, {
      cursorCodec: { hmacKey: generateCursorHmacKey() },
      pool: runtimePool,
      searchRepository: search,
      sessions,
      traversalOptions: { cursorCodec: { hmacKey: generateCursorHmacKey() }, pool: runtimePool },
    });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await runtimePool.end();
    await adminPool.end();
    await environment.stop();
  });

  it("enforces Category and Money Space endpoint ownership", async () => {
    const categories = await app.inject({
      headers: headers(ACCOUNT_B),
      method: "GET",
      url: "/api/v1/categories",
    });
    expect(categories.statusCode).toBe(200);
    expect(categories.body).not.toContain(categoryA.id);
    const spaces = await app.inject({
      headers: headers(ACCOUNT_B),
      method: "GET",
      url: "/api/v1/money-spaces",
    });
    expect(spaces.body).not.toContain(spaceA.id);
  });

  it("covers create, rename, deactivate, restore, and stale revision", async () => {
    const createdResponse = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "POST",
      payload: { kind: "expense", name: "Lifecycle label" },
      url: "/api/v1/categories",
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json<{ id: string; revision: string }>();
    const renamedResponse = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "PATCH",
      payload: { expectedRevision: created.revision, name: "Lifecycle renamed" },
      url: `/api/v1/categories/${created.id}`,
    });
    expect(renamedResponse.statusCode).toBe(200);
    const renamed = renamedResponse.json<{ revision: string }>();
    const stale = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "PATCH",
      payload: { expectedRevision: created.revision, status: "inactive" },
      url: `/api/v1/categories/${created.id}`,
    });
    expect(stale.json()).toEqual({ messageCode: "REVISION_CONFLICT" });
    const inactiveResponse = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "PATCH",
      payload: { expectedRevision: renamed.revision, status: "inactive" },
      url: `/api/v1/categories/${created.id}`,
    });
    const inactive = inactiveResponse.json<{ revision: string; status: string }>();
    expect(inactive.status).toBe("inactive");
    const restored = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "PATCH",
      payload: { expectedRevision: inactive.revision, status: "active" },
      url: `/api/v1/categories/${created.id}`,
    });
    expect(restored.json<{ status: string }>().status).toBe("active");
  });

  it("isolates normalized uniqueness by account and rejects cross-kind ID use", async () => {
    await expect(
      labels.createCategory(ACCOUNT_B, {
        idempotencyKey: randomUUID(),
        kind: "expense",
        name: "Account A category",
      }),
    ).resolves.toBeDefined();
    await expect(
      labels.renameMoneySpace(ACCOUNT_A, categoryA.id, {
        expectedRevision: categoryA.revision,
        name: "wrong kind",
      }),
    ).rejects.toMatchObject({ code: "LABEL_KIND_MISMATCH" });
  });

  it("search endpoint intersects every dimension and returns only account A", async () => {
    const response = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "POST",
      payload: searchPayload({
        filters: {
          categoryIds: [categoryA.id],
          currencies: ["USD"],
          directions: ["expense"],
          from: "2026-07-01T00:00:00Z",
          lifecycles: ["active"],
          moneySpaceIds: [spaceA.id],
          planningStatuses: ["planned"],
          purposes: ["personal"],
          to: "2026-07-05T00:00:00Z",
        },
        query: "isolation token",
      }),
      url: "/api/v1/memos/search",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { categoryId: string; note: string }[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.categoryId).toBe(categoryA.id);
    expect(response.body).not.toContain("other private");
  });

  it("uses the GIN search index", async () => {
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const plan = await client.query<{ "QUERY PLAN": string }>(
        `EXPLAIN (COSTS OFF)
         SELECT id FROM money_memos
         WHERE search_vector @@ plainto_tsquery('simple', 'isolation')`,
      );
      const rendered = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(rendered).toContain("money_memos_search_vector_idx");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("binds cursor to query and authenticated account", async () => {
    const first = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "POST",
      payload: searchPayload({ query: "isolation" }),
      url: "/api/v1/memos/search",
    });
    const cursor = first.json<{ nextCursor: string }>().nextCursor;
    const changedQuery = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "POST",
      payload: searchPayload({ cursor, query: "different" }),
      url: "/api/v1/memos/search",
    });
    expect(changedQuery.statusCode).toBe(409);
    const changedAccount = await app.inject({
      headers: headers(ACCOUNT_B),
      method: "POST",
      payload: searchPayload({ cursor, query: "isolation" }),
      url: "/api/v1/memos/search",
    });
    expect(changedAccount.statusCode).toBe(409);
    expect(changedAccount.body).not.toContain("other private");
  });

  it("returns zero rows when account B supplies account A label ID", async () => {
    const response = await app.inject({
      headers: headers(ACCOUNT_B),
      method: "POST",
      payload: searchPayload({
        filters: {
          categoryIds: [categoryA.id],
          currencies: [],
          directions: [],
          from: null,
          lifecycles: [],
          moneySpaceIds: [],
          planningStatuses: [],
          purposes: [],
          to: null,
        },
      }),
      url: "/api/v1/memos/search",
    });
    expect(response.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it("does not disclose cross-account search text, values, or membership", async () => {
    const response = await app.inject({
      headers: headers(ACCOUNT_A),
      method: "POST",
      payload: searchPayload({ query: "other private" }),
      url: "/api/v1/memos/search",
    });
    expect(response.json<{ items: unknown[] }>().items).toEqual([]);
    expect(response.body).not.toContain("Account B category");
  });
});
