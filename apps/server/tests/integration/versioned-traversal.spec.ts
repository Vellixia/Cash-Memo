import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";
import {
  encodeCursor,
  decodeCursor,
  generateCursorHmacKey,
  CursorCodecError,
  type CursorCodecOptions,
} from "../../src/modules/history/cursor-codec.js";
import {
  computeQueryFingerprint,
  type TraversalQuery,
} from "../../src/modules/history/query-fingerprint.js";
import {
  getHistoryListVersion,
  incrementHistoryListVersion,
} from "../../src/modules/history/history-list-state.repository.js";
import {
  queryFirstPage,
  queryContinuation,
  TraversalError,
  type VersionedTraversalOptions,
} from "../../src/modules/history/versioned-traversal.service.js";
import { withAccountTransaction } from "../../src/adapters/postgres/transaction-context.js";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000002";

const DEFAULT_QUERY: TraversalQuery = {
  categoryIds: [],
  currencies: [],
  directions: [],
  from: null,
  lifecycle: "active",
  moneySpaceIds: [],
  planningStatuses: [],
  purposes: [],
  searchQuery: null,
  to: null,
};

async function createMemo(pool: Pool, accountId: string, occurredAt: string): Promise<string> {
  return withAccountTransaction(pool, accountId, async (tx) => {
    const result = await tx.query<{ id: string }>(
      `INSERT INTO money_memos (
        id, user_id, direction, amount_minor, currency_code, currency_exponent,
        currency_registry_version, occurred_at, occurred_local, occurred_timezone,
        occurred_offset_minutes, timezone_database_version, origin, lifecycle_state, revision
      ) VALUES (
        gen_random_uuid(), $1, 'expense', 1000, 'USD', 2, 'test-v1', $2, timestamp '2026-01-15 10:00:00',
        'UTC', 0, 'test-tzdb', 'manual', 'active', 1
      ) RETURNING id`,
      [accountId, occurredAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("CREATE_FAILED");
    await tx.query(
      `INSERT INTO history_list_states (user_id, version, updated_at)
       VALUES ($1, 1, now())
       ON CONFLICT (user_id) DO UPDATE SET version = history_list_states.version + 1, updated_at = now()`,
      [accountId],
    );
    return row.id;
  });
}

async function updateMemoLifecycle(
  pool: Pool,
  accountId: string,
  memoId: string,
  newState: string,
): Promise<void> {
  await withAccountTransaction(pool, accountId, async (tx) => {
    await tx.query(
      `UPDATE money_memos SET lifecycle_state = $3::text::memo_lifecycle_state, updated_at = now(), revision = revision + 1
       WHERE id = $1 AND user_id = $2`,
      [memoId, accountId, newState],
    );
    await tx.query(
      `UPDATE history_list_states SET version = version + 1, updated_at = now() WHERE user_id = $1`,
      [accountId],
    );
  });
}

describe("versioned traversal integration (FR-030; SC-026)", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;
  let runtimePool: Pool;
  let cursorOptions: CursorCodecOptions;
  let traversalOptions: VersionedTraversalOptions;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
        ($1, 'Cashmemo account', 'a@cashmemo.test', true, 'active'),
        ($2, 'Cashmemo account', 'b@cashmemo.test', true, 'active')`,
      [ACCOUNT_A, ACCOUNT_B],
    );
    cursorOptions = { hmacKey: generateCursorHmacKey() };
    runtimePool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_runtime",
    });
    traversalOptions = { cursorCodec: cursorOptions, pool: runtimePool };
  }, 120_000);

  afterAll(async () => {
    await runtimePool?.end();
    await adminPool?.end();
    await environment?.stop();
  });

  it("first page returns resultSetVersion", async () => {
    await createMemo(runtimePool, ACCOUNT_A, "2026-01-01T10:00:00.000Z");
    await createMemo(runtimePool, ACCOUNT_A, "2026-01-02T10:00:00.000Z");
    const page = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 10, traversalOptions);
    expect(page.resultSetVersion).toBeGreaterThan(0);
    expect(page.items.length).toBeGreaterThanOrEqual(2);
  });

  it("unchanged continuation succeeds with no duplicates", async () => {
    for (let i = 0; i < 15; i++) {
      await createMemo(
        runtimePool,
        ACCOUNT_A,
        `2026-02-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      );
    }
    const page1 = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 5, traversalOptions);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await queryContinuation(
      runtimePool,
      ACCOUNT_A,
      DEFAULT_QUERY,
      page1.nextCursor!,
      5,
      traversalOptions,
    );
    const allIds = [...page1.items.map((i) => i.id), ...page2.items.map((i) => i.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("stale version after create returns RESULTS_CHANGED", async () => {
    const page1 = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 5, traversalOptions);
    await createMemo(runtimePool, ACCOUNT_A, "2026-03-01T10:00:00.000Z");
    await expect(
      queryContinuation(
        runtimePool,
        ACCOUNT_A,
        DEFAULT_QUERY,
        page1.nextCursor!,
        5,
        traversalOptions,
      ),
    ).rejects.toThrow(TraversalError);
  });

  it("stale version after archive returns RESULTS_CHANGED", async () => {
    const memoId = await createMemo(runtimePool, ACCOUNT_A, "2026-04-01T10:00:00.000Z");
    const page1 = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 5, traversalOptions);
    await updateMemoLifecycle(runtimePool, ACCOUNT_A, memoId, "archived");
    await expect(
      queryContinuation(
        runtimePool,
        ACCOUNT_A,
        DEFAULT_QUERY,
        page1.nextCursor!,
        5,
        traversalOptions,
      ),
    ).rejects.toThrow(TraversalError);
  });

  it("stale version after delete returns RESULTS_CHANGED", async () => {
    const memoId = await createMemo(runtimePool, ACCOUNT_A, "2026-05-01T10:00:00.000Z");
    const page1 = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 5, traversalOptions);
    await updateMemoLifecycle(runtimePool, ACCOUNT_A, memoId, "recently_deleted");
    await expect(
      queryContinuation(
        runtimePool,
        ACCOUNT_A,
        DEFAULT_QUERY,
        page1.nextCursor!,
        5,
        traversalOptions,
      ),
    ).rejects.toThrow(TraversalError);
  });

  it("query mismatch rejects continuation", async () => {
    const page1 = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 5, traversalOptions);
    const differentQuery: TraversalQuery = { ...DEFAULT_QUERY, lifecycle: "archived" };
    await expect(
      queryContinuation(
        runtimePool,
        ACCOUNT_A,
        differentQuery,
        page1.nextCursor!,
        5,
        traversalOptions,
      ),
    ).rejects.toThrow(TraversalError);
  });

  it("cursor tampering is rejected", async () => {
    const page1 = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 5, traversalOptions);
    const tamperedCursor = page1.nextCursor!.slice(0, -5) + "XXXXX";
    await expect(
      queryContinuation(runtimePool, ACCOUNT_A, DEFAULT_QUERY, tamperedCursor, 5, traversalOptions),
    ).rejects.toThrow(CursorCodecError);
  });

  it("account A cursor cannot be used by account B", async () => {
    const page1 = await queryFirstPage(runtimePool, ACCOUNT_A, DEFAULT_QUERY, 5, traversalOptions);
    await expect(
      queryContinuation(
        runtimePool,
        ACCOUNT_B,
        DEFAULT_QUERY,
        page1.nextCursor!,
        5,
        traversalOptions,
      ),
    ).rejects.toThrow();
  });

  it("cursor codec round-trips correctly", () => {
    const payload = {
      cursorFormatVersion: 1,
      lastId: "test-id-123",
      lastOccurredAt: "2026-01-15T10:00:00.000Z",
      queryFingerprint: "abc123",
      version: 5,
    };
    const encoded = encodeCursor(payload, cursorOptions);
    const decoded = decodeCursor(encoded, cursorOptions);
    expect(decoded).toEqual(payload);
  });

  it("malformed cursor is rejected", async () => {
    await expect(decodeCursor("not-a-valid-cursor", cursorOptions)).rejects.toThrow(
      CursorCodecError,
    );
    await expect(decodeCursor("", cursorOptions)).rejects.toThrow(CursorCodecError);
  });

  it("query fingerprint is deterministic for equivalent queries", () => {
    const query1: TraversalQuery = {
      ...DEFAULT_QUERY,
      directions: ["income", "expense"],
      currencies: ["USD", "IDR"],
    };
    const query2: TraversalQuery = {
      ...DEFAULT_QUERY,
      directions: ["expense", "income"],
      currencies: ["IDR", "USD"],
    };
    expect(computeQueryFingerprint(query1)).toBe(computeQueryFingerprint(query2));
  });

  it("query fingerprint differs for different queries", () => {
    const query1: TraversalQuery = { ...DEFAULT_QUERY, lifecycle: "active" };
    const query2: TraversalQuery = { ...DEFAULT_QUERY, lifecycle: "archived" };
    expect(computeQueryFingerprint(query1)).not.toBe(computeQueryFingerprint(query2));
  });

  it("history list version never decreases", async () => {
    const v1 = await getHistoryListVersion(runtimePool, ACCOUNT_A);
    await incrementHistoryListVersion(runtimePool, ACCOUNT_A);
    const v2 = await getHistoryListVersion(runtimePool, ACCOUNT_A);
    expect(v2).toBeGreaterThan(v1);
  });
});
