import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertSyntheticSeedAllowed,
  seedSyntheticData,
  syntheticIds,
} from "../../src/adapters/postgres/seeds/synthetic.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

describe("guarded synthetic seed", () => {
  let environment: TestEnvironment;
  let pool: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    pool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(pool);
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await environment.stop();
  });

  it("fails closed without an explicit non-production guard", () => {
    expect(() => {
      assertSyntheticSeedAllowed({ NODE_ENV: "test" });
    }).toThrow("SYNTHETIC_SEED_NOT_ALLOWED");
    expect(() => {
      assertSyntheticSeedAllowed({
        CASHMEMO_ALLOW_SYNTHETIC_SEED: "1",
        NODE_ENV: "production",
      });
    }).toThrow("SYNTHETIC_SEED_NOT_ALLOWED");
  });

  it("creates two isolated accounts, labels, currency/timezone rows, drafts, and lifecycle states", async () => {
    await seedSyntheticData(pool, {
      CASHMEMO_ALLOW_SYNTHETIC_SEED: "1",
      NODE_ENV: "test",
    });
    await seedSyntheticData(pool, {
      CASHMEMO_ALLOW_SYNTHETIC_SEED: "1",
      NODE_ENV: "test",
    });

    const accounts = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[syntheticIds.accountOne, syntheticIds.accountTwo]],
    );
    expect(accounts.rows.map((row) => row.id)).toEqual([
      syntheticIds.accountOne,
      syntheticIds.accountTwo,
    ]);

    const memos = await pool.query<{
      currency_code: string;
      lifecycle_state: string;
      occurred_timezone: string;
      user_id: string;
    }>(
      `SELECT user_id, currency_code, occurred_timezone, lifecycle_state
       FROM money_memos
       WHERE user_id = ANY($1::uuid[])
       ORDER BY id`,
      [[syntheticIds.accountOne, syntheticIds.accountTwo]],
    );
    expect(memos.rows).toHaveLength(5);
    expect(new Set(memos.rows.map((row) => row.currency_code))).toEqual(new Set(["IDR", "USD"]));
    expect(new Set(memos.rows.map((row) => row.occurred_timezone))).toEqual(
      new Set(["Asia/Jakarta", "America/New_York"]),
    );
    expect(new Set(memos.rows.map((row) => row.lifecycle_state))).toEqual(
      new Set(["active", "archived", "recently_deleted"]),
    );

    const drafts = await pool.query<{ user_id: string }>("SELECT user_id FROM compose_drafts");
    expect(drafts.rows).toEqual([{ user_id: syntheticIds.accountOne }]);

    const labels = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM categories
       UNION ALL
       SELECT user_id FROM money_spaces`,
    );
    expect(new Set(labels.rows.map((row) => row.user_id))).toEqual(
      new Set([syntheticIds.accountOne, syntheticIds.accountTwo]),
    );
  });
});
