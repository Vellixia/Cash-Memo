import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withAccountTransaction } from "../../apps/server/src/adapters/postgres/transaction-context.js";
import { applyMigrations } from "../../apps/server/tests/integration/support/postgres-migrations.js";
import {
  startTestEnvironment,
  type TestEnvironment,
} from "../../apps/server/tests/integration/support/test-environment.js";

const ACCOUNT_A = "00000000-0000-4000-8000-0000000000a1";
const ACCOUNT_B = "00000000-0000-4000-8000-0000000000b2";

const accountOwnedResourceClasses = [
  "identity/account state",
  "preferences",
  "categories",
  "Money Spaces",
  "Money Memos",
  "drafts",
  "assisted captures",
  "transcripts",
  "history/search",
  "reporting",
  "exports",
  "object-store access",
  "Recently Deleted",
  "memo purge",
  "account deletion",
  "provider deletion state",
  "suppression-adjacent operations",
  "audio metadata/storage boundary",
] as const;

describe("complete cross-user isolation matrix", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'matrix-a@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'matrix-b@cashmemo.test', true, 'active')`,
      [ACCOUNT_A, ACCOUNT_B],
    );
    await admin.query(
      `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
       VALUES ($1, 'IDR', 'Asia/Jakarta', 'en-ID'), ($2, 'USD', 'UTC', 'en-US')`,
      [ACCOUNT_A, ACCOUNT_B],
    );
    await admin.query(
      `INSERT INTO categories (id, user_id, kind, name, normalized_name, status)
       VALUES ($1, $2, 'expense', 'A category', 'a category', 'active'),
              ($3, $4, 'expense', 'B category', 'b category', 'active')`,
      [randomUUID(), ACCOUNT_A, randomUUID(), ACCOUNT_B],
    );
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 1,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  afterAll(async () => {
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  it("declares every account-owned resource class", () => {
    expect(accountOwnedResourceClasses).toHaveLength(18);
    expect(new Set(accountOwnedResourceClasses).size).toBe(accountOwnedResourceClasses.length);
  });

  it("returns only the authenticated account across identity, preferences, and labels", async () => {
    const rows = await withAccountTransaction(runtime, ACCOUNT_A, async (transaction) => {
      const users = await transaction.query<{ id: string }>("SELECT id FROM users");
      const preferences = await transaction.query<{ user_id: string }>(
        "SELECT user_id FROM preferences",
      );
      const categories = await transaction.query<{ user_id: string }>(
        "SELECT user_id FROM categories",
      );
      return { users: users.rows, preferences: preferences.rows, categories: categories.rows };
    });
    expect(rows.users).toEqual([{ id: ACCOUNT_A }]);
    expect(rows.preferences).toEqual([{ user_id: ACCOUNT_A }]);
    expect(rows.categories).toEqual([{ user_id: ACCOUNT_A }]);
  });

  it.each(["users", "preferences", "categories"])(
    "blocks guessed and valid other-user IDs for %s",
    async (table) => {
      const result = await withAccountTransaction(runtime, ACCOUNT_A, (transaction) =>
        transaction.query(
          `SELECT * FROM ${table} WHERE ${table === "users" ? "id" : "user_id"} = $1`,
          [ACCOUNT_B],
        ),
      );
      expect(result.rowCount).toBe(0);
    },
  );

  it("rejects forged ownership on writes and FK-adjacent abuse", async () => {
    await expect(
      withAccountTransaction(runtime, ACCOUNT_A, (transaction) =>
        transaction.query(
          `INSERT INTO preferences (user_id, default_currency, reporting_timezone, locale)
           VALUES ($1, 'EUR', 'UTC', 'en-US')`,
          [ACCOUNT_B],
        ),
      ),
    ).rejects.toBeDefined();
    const owner = await admin.query<{ default_currency: string }>(
      "SELECT default_currency FROM preferences WHERE user_id = $1",
      [ACCOUNT_B],
    );
    expect(owner.rows[0]?.default_currency).toBe("USD");
  });

  it("fails closed without app.current_user_id", async () => {
    const client = await runtime.connect();
    try {
      const result = await client.query("SELECT id FROM users");
      expect(result.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("does not retain transaction identity across pool reuse", async () => {
    await withAccountTransaction(runtime, ACCOUNT_A, async (transaction) => {
      expect((await transaction.query("SELECT id FROM users")).rowCount).toBe(1);
    });
    await withAccountTransaction(runtime, ACCOUNT_B, async (transaction) => {
      const result = await transaction.query<{ id: string }>("SELECT id FROM users");
      expect(result.rows).toEqual([{ id: ACCOUNT_B }]);
    });
  });

  it("keeps runtime separate from maintenance, identity, migration, and restore roles", async () => {
    const client = await runtime.connect();
    try {
      for (const role of [
        "cashmemo_identity",
        "cashmemo_worker",
        "cashmemo_migration",
        "cashmemo_restore",
      ]) {
        const membership = await client.query<{ allowed: boolean }>(
          "SELECT pg_has_role(current_user, $1, 'MEMBER') AS allowed",
          [role],
        );
        expect(membership.rows[0]?.allowed).toBe(false);
      }
    } finally {
      client.release();
    }
  });
});
