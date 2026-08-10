import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBetterAuthAdapter,
  type BetterAuthDeliveryCallbacks,
} from "../../src/modules/identity/better-auth.adapter.js";
import { IdentityService } from "../../src/modules/identity/identity.service.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const TEST_SECRET = "cashmemo-identity-boundary-secret-v1";
const IDEMPOTENCY_HMAC_KEY = Buffer.alloc(32, 17);

const delivery: BetterAuthDeliveryCallbacks = {
  sendPasswordReset: () => Promise.resolve(),
  sendVerification: () => Promise.resolve(),
};

describe("identity service with dedicated identity role", { concurrent: false }, () => {
  let environment: TestEnvironment | undefined;
  let migrationPool: Pool | undefined;
  let identityPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let identity: IdentityService;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    migrationPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(migrationPool);

    identityPool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_identity",
    });
    await expect(identityPool.query(`SELECT current_user`)).resolves.toMatchObject({
      rows: [{ current_user: "cashmemo_identity" }],
    });

    runtimePool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_runtime",
    });
    await expect(runtimePool.query(`SELECT current_user`)).resolves.toMatchObject({
      rows: [{ current_user: "cashmemo_runtime" }],
    });

    const auth = createBetterAuthAdapter({
      baseURL: "https://cashmemo.test",
      delivery,
      identityPool,
      secret: TEST_SECRET,
      trustedOrigins: ["https://cashmemo.test"],
    });
    identity = new IdentityService({
      auth,
      idempotencyHmacKey: IDEMPOTENCY_HMAC_KEY,
      identityPool,
      runtimePool,
    });
  }, 120_000);

  afterAll(async () => {
    await identityPool?.end();
    await runtimePool?.end();
    await migrationPool?.end();
    await environment?.stop();
  }, 30_000);

  it("proves cashmemo_runtime cannot insert users (RLS blocks pre-auth)", async () => {
    await expect(
      runtimePool?.query(
        `INSERT INTO users (name, email, email_verified)
         VALUES ('Cashmemo account', 'runtime-blocked@example.test', false)`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("proves cashmemo_identity can insert users (identity access policy)", async () => {
    await expect(
      identityPool?.query(
        `INSERT INTO users (name, email, email_verified)
         VALUES ('Cashmemo account', 'identity-can-insert@example.test', false)`,
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it("proves cashmemo_identity cannot access money_memos (domain confinement)", async () => {
    await expect(identityPool?.query(`SELECT count(*) FROM money_memos`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_identity cannot access profiles (domain confinement)", async () => {
    await expect(identityPool?.query(`SELECT count(*) FROM profiles`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_identity cannot access preferences (domain confinement)", async () => {
    await expect(identityPool?.query(`SELECT count(*) FROM preferences`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_identity cannot access compose_drafts (domain confinement)", async () => {
    await expect(identityPool?.query(`SELECT count(*) FROM compose_drafts`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_identity cannot access background_jobs (domain confinement)", async () => {
    await expect(identityPool?.query(`SELECT count(*) FROM background_jobs`)).rejects.toMatchObject(
      { code: "42501" },
    );
  });

  it("proves cashmemo_identity cannot SET ROLE to cashmemo_runtime", async () => {
    await expect(identityPool?.query(`SET ROLE cashmemo_runtime`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_identity cannot SET ROLE to cashmemo_migration", async () => {
    await expect(identityPool?.query(`SET ROLE cashmemo_migration`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_identity cannot SET ROLE to cashmemo_worker", async () => {
    await expect(identityPool?.query(`SET ROLE cashmemo_worker`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_identity cannot SET ROLE to cashmemo_restore", async () => {
    await expect(identityPool?.query(`SET ROLE cashmemo_restore`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_runtime cannot access sessions (revoked in 0004)", async () => {
    await expect(runtimePool?.query(`SELECT count(*) FROM sessions`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves cashmemo_runtime cannot access credential_accounts (revoked in 0004)", async () => {
    await expect(
      runtimePool?.query(`SELECT count(*) FROM credential_accounts`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("proves cashmemo_runtime cannot access verification_tokens (revoked in 0004)", async () => {
    await expect(
      runtimePool?.query(`SELECT count(*) FROM verification_tokens`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("creates an unverified credential account through the identity boundary", async () => {
    await expect(
      identity.signUp({
        email: "identity-signup@example.test",
        idempotencyKey: "0198a6d8-1a30-7c55-a5b1-a3f27f8234f1",
        password: "Synthetic-Password-1!",
      }),
    ).resolves.toEqual({
      messageCode: "CHECK_EMAIL_IF_ELIGIBLE",
      status: "accepted",
    });

    await expect(
      migrationPool?.query(
        `SELECT count(*)::text AS count
           FROM users
          WHERE email = 'identity-signup@example.test'`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: "1" }] });
  });

  it("persists user and credential account through identity role", async () => {
    await identity.signUp({
      email: "persist-check@example.test",
      idempotencyKey: "0198a6d8-2a30-7c55-a5b1-a3f27f8234f2",
      password: "Synthetic-Password-2!",
    });

    const userResult = await migrationPool?.query<{
      id: string;
      email: string;
      email_verified: boolean;
      name: string;
      status: string;
    }>(
      `SELECT id, email, email_verified, name, status
         FROM users
        WHERE email = 'persist-check@example.test'`,
    );
    expect(userResult?.rowCount).toBe(1);
    const userRow = userResult?.rows[0];
    expect(userRow?.email).toBe("persist-check@example.test");
    expect(userRow?.email_verified).toBe(false);
    expect(userRow?.name).toBe("Cashmemo account");

    const credResult = await migrationPool?.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM credential_accounts
        WHERE user_id = $1`,
      [userRow?.id],
    );
    expect(credResult?.rows[0]?.count).toBe("1");
  });

  it("returns enumeration-safe response on duplicate signup", async () => {
    const email = "duplicate-check@example.test";
    await identity.signUp({
      email,
      idempotencyKey: "0198a6d8-3a30-7c55-a5b1-a3f27f8234f3",
      password: "Synthetic-Password-3!",
    });

    await expect(
      identity.signUp({
        email,
        idempotencyKey: "0198a6d8-4a30-7c55-a5b1-a3f27f8234f4",
        password: "Synthetic-Password-4!",
      }),
    ).resolves.toEqual({
      messageCode: "CHECK_EMAIL_IF_ELIGIBLE",
      status: "accepted",
    });
  });

  it("proves identity pool never acquires runtime account context", async () => {
    const result = await identityPool?.query<{ ctx: string | null }>(
      `SELECT NULLIF(current_setting('app.current_user_id', true), '') AS ctx`,
    );
    expect(result?.rows[0]?.ctx).toBeNull();
  });

  it("proves runtime pool never becomes identity role after checkout reuse", async () => {
    if (runtimePool === undefined) throw new Error("runtime pool not initialized");
    const client1 = await runtimePool.connect();
    client1.release();
    const client2 = await runtimePool.connect();
    const result = await client2.query<{ current_user: string }>(`SELECT current_user`);
    const row = result.rows[0];
    if (row === undefined) throw new Error("no current_user row");
    expect(row.current_user).toBe("cashmemo_runtime");
    client2.release();
  });
});
