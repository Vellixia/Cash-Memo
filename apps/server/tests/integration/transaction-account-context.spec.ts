import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withAccountTransaction } from "../../src/adapters/postgres/transaction-context.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT_ONE = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_TWO = "00000000-0000-4000-8000-000000000002";
const RUNTIME_PASSWORD = "cashmemo-runtime-test-only";
const IDENTITY_PASSWORD = "cashmemo-identity-test-only";

describe("transaction-local authenticated-account context", () => {
  let environment: TestEnvironment;
  let adminPool: Pool;
  let runtimePool: Pool;
  let identityPool: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");

    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `CREATE ROLE cashmemo_http LOGIN PASSWORD '${RUNTIME_PASSWORD}' IN ROLE cashmemo_runtime`,
    );
    await adminPool.query(
      `CREATE ROLE cashmemo_identity_login LOGIN PASSWORD '${IDENTITY_PASSWORD}' IN ROLE cashmemo_identity`,
    );
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status)
       VALUES
         ($1, 'Cashmemo account', 'account-one@example.test', true, 'active'),
         ($2, 'Cashmemo account', 'account-two@example.test', true, 'active')`,
      [ACCOUNT_ONE, ACCOUNT_TWO],
    );

    const runtimeUrl = new URL(environment.postgres.connectionUri);
    runtimeUrl.username = "cashmemo_http";
    runtimeUrl.password = RUNTIME_PASSWORD;
    runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });

    const identityUrl = new URL(environment.postgres.connectionUri);
    identityUrl.username = "cashmemo_identity_login";
    identityUrl.password = IDENTITY_PASSWORD;
    identityPool = new Pool({ connectionString: identityUrl.toString(), max: 1 });
  }, 120_000);

  afterAll(async () => {
    await identityPool.end();
    await runtimePool.end();
    await adminPool.end();
    await environment.stop();
  });

  it("fails closed when account context is absent", async () => {
    const result = await runtimePool.query<{ count: string }>("SELECT count(*) FROM users");
    expect(result.rows[0]?.count).toBe("0");
  });

  it("rejects a forged account identifier before opening a transaction", async () => {
    await expect(
      withAccountTransaction(runtimePool, `${ACCOUNT_ONE}'; RESET ROLE; --`, () =>
        Promise.resolve(undefined),
      ),
    ).rejects.toThrow("INVALID_AUTHENTICATED_ACCOUNT_ID");
  });

  it("exposes only owned rows and blocks a cross-account write", async () => {
    await withAccountTransaction(runtimePool, ACCOUNT_ONE, async (transaction) => {
      const visible = await transaction.query<{ id: string }>("SELECT id FROM users ORDER BY id");
      expect(visible.rows.map((row) => row.id)).toEqual([ACCOUNT_ONE]);

      await expect(
        transaction.query("UPDATE users SET updated_at = now() WHERE id = $1", [ACCOUNT_TWO]),
      ).resolves.toMatchObject({ rowCount: 0 });
    });
  });

  it("does not leak account context when one pooled connection is reused", async () => {
    const seen: string[] = [];
    for (const accountId of [ACCOUNT_ONE, ACCOUNT_TWO, ACCOUNT_ONE]) {
      await withAccountTransaction(runtimePool, accountId, async (transaction) => {
        const result = await transaction.query<{ id: string }>("SELECT id FROM users");
        seen.push(result.rows[0]?.id ?? "missing");
      });
    }
    expect(seen).toEqual([ACCOUNT_ONE, ACCOUNT_TWO, ACCOUNT_ONE]);

    const outsideTransaction = await runtimePool.query<{ count: string }>(
      "SELECT count(*) FROM users",
    );
    expect(outsideTransaction.rows[0]?.count).toBe("0");
  });

  it("proves identity pool cannot access account-owned domain tables", async () => {
    await expect(identityPool.query("SELECT count(*) FROM money_memos")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(identityPool.query("SELECT count(*) FROM profiles")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(identityPool.query("SELECT count(*) FROM preferences")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves identity pool cannot SET ROLE to cashmemo_runtime", async () => {
    await expect(identityPool.query("SET ROLE cashmemo_runtime")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves runtime pool cannot access sessions (revoked in 0004)", async () => {
    await expect(runtimePool.query("SELECT count(*) FROM sessions")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves runtime pool cannot access credential_accounts (revoked in 0004)", async () => {
    await expect(
      runtimePool.query("SELECT count(*) FROM credential_accounts"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("proves runtime pool cannot access verification_tokens (revoked in 0004)", async () => {
    await expect(
      runtimePool.query("SELECT count(*) FROM verification_tokens"),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
