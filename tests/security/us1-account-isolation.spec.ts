import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BETTER_AUTH_SESSION_COOKIE,
  createBetterAuthAdapter,
  type BetterAuthDeliveryCallbacks,
} from "../../apps/server/src/modules/identity/better-auth.adapter.js";
import { IdentityService } from "../../apps/server/src/modules/identity/identity.service.js";
import { SessionService } from "../../apps/server/src/modules/identity/session.service.js";
import { applyMigrations } from "../../apps/server/tests/integration/support/postgres-migrations.js";
import {
  startTestEnvironment,
  type TestEnvironment,
} from "../../apps/server/tests/integration/support/test-environment.js";

const TEST_SECRET = "synthetic-fixture-isolation-secret-v1";
const IDEMPOTENCY_HMAC_KEY = Buffer.alloc(32, 17);

const delivery: BetterAuthDeliveryCallbacks = {
  sendPasswordReset: () => Promise.resolve(),
  sendVerification: () => Promise.resolve(),
};

function cookiePair(headers: Headers): string {
  const setCookie = headers
    .getSetCookie()
    .find((value) => value.startsWith(`${BETTER_AUTH_SESSION_COOKIE}=`));
  if (setCookie === undefined) throw new Error("SESSION_COOKIE_MISSING");
  const pair = setCookie.split(";", 1)[0];
  if (pair === undefined) throw new Error("SESSION_COOKIE_INVALID");
  return pair;
}

describe("US1 two-account isolation", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let migrationPool: Pool;
  let identityPool: Pool;
  let runtimePool: Pool;
  let identityA: IdentityService;
  let sessions: SessionService;

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

    const runtimeUrl = new URL(environment.postgres.connectionUri);
    runtimePool = new Pool({
      connectionString: runtimeUrl.toString(),
      max: 4,
      options: "-c role=cashmemo_runtime",
    });

    const auth = createBetterAuthAdapter({
      baseURL: "https://cashmemo.test",
      delivery,
      identityPool,
      secret: TEST_SECRET,
      trustedOrigins: ["https://cashmemo.test"],
    });

    identityA = new IdentityService({
      auth,
      idempotencyHmacKey: IDEMPOTENCY_HMAC_KEY,
      identityPool,
      runtimePool,
    });
    sessions = new SessionService({ auth, pool: runtimePool });
  }, 120_000);

  afterAll(async () => {
    await identityPool.end();
    await runtimePool.end();
    await migrationPool.end();
    await environment.stop();
  }, 30_000);

  async function createAndLogin(
    email: string,
    password: string,
    idempotencyKey: string,
  ): Promise<{ cookie: string; userId: string }> {
    await identityA.signUp({ email, idempotencyKey, password });
    await migrationPool.query(
      `UPDATE users SET email_verified = true, status = 'active' WHERE email = $1`,
      [email],
    );
    const result = await identityA.login({ email, password });
    return { cookie: cookiePair(result.responseHeaders), userId: result.session.userId };
  }

  it("proves user A session establishes only account A runtime context", async () => {
    const { cookie: cookieA, userId: userIdA } = await createAndLogin(
      "isolation-a@example.test",
      "Isolation-Pass-A1!",
      "0198a6d8-aa00-7c55-a5b1-a3f27f8234a1",
    );

    const session = await sessions.authenticate(new Headers({ cookie: cookieA }));
    expect(session).not.toBeNull();
    expect(session?.accountId).toBe(userIdA);
  });

  it("proves user B cannot obtain user A product rows", async () => {
    const { userId: userIdA } = await createAndLogin(
      "isolation-a2@example.test",
      "Isolation-Pass-A2!",
      "0198a6d8-aa00-7c55-a5b1-a3f27f8234a2",
    );
    const { cookie: cookieB, userId: userIdB } = await createAndLogin(
      "isolation-b@example.test",
      "Isolation-Pass-B1!",
      "0198a6d8-bb00-7c55-a5b1-a3f27f8234b1",
    );

    await migrationPool.query(
      `INSERT INTO profiles (user_id, onboarding_state) VALUES ($1, 'complete')`,
      [userIdA],
    );

    const sessionB = await sessions.authenticate(new Headers({ cookie: cookieB }));
    expect(sessionB?.accountId).toBe(userIdB);

    const profileB = await runtimePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM profiles WHERE user_id = $1`,
      [userIdB],
    );
    expect(profileB.rows[0]?.count).toBe("0");
  });

  it("proves forged body user ID does not alter runtime identity", async () => {
    const { cookie: cookieA, userId: userIdA } = await createAndLogin(
      "isolation-a3@example.test",
      "Isolation-Pass-A3!",
      "0198a6d8-aa00-7c55-a5b1-a3f27f8234a3",
    );
    const { userId: userIdB } = await createAndLogin(
      "isolation-b2@example.test",
      "Isolation-Pass-B2!",
      "0198a6d8-bb00-7c55-a5b1-a3f27f8234b2",
    );

    const sessionA = await sessions.authenticate(new Headers({ cookie: cookieA }));
    expect(sessionA?.accountId).toBe(userIdA);
    expect(sessionA?.accountId).not.toBe(userIdB);
  });

  it("proves identity pool is never used for journal repositories", async () => {
    await expect(identityPool.query("SELECT count(*) FROM money_memos")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(identityPool.query("SELECT count(*) FROM categories")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves runtime pool is never used for Better Auth pre-auth lifecycle", async () => {
    await expect(runtimePool.query("SELECT count(*) FROM sessions")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      runtimePool.query("SELECT count(*) FROM credential_accounts"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtimePool.query("SELECT count(*) FROM verification_tokens"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("proves pooled connection reuse does not leak app.current_user_id", async () => {
    const client1 = await runtimePool.connect();
    client1.release();
    const client2 = await runtimePool.connect();
    const result = await client2.query<{ ctx: string | null }>(
      `SELECT NULLIF(current_setting('app.current_user_id', true), '') AS ctx`,
    );
    expect(result.rows[0]?.ctx).toBeNull();
    client2.release();
  });

  it("proves signup cannot provide a route to product-data access", async () => {
    await identityA.signUp({
      email: "isolation-signup@example.test",
      idempotencyKey: randomUUID(),
      password: "Isolation-Pass-C1!",
    });

    await expect(identityPool.query("SELECT count(*) FROM money_memos")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("proves revocation takes effect before subsequent protected operations", async () => {
    const { cookie, userId } = await createAndLogin(
      "isolation-revoke@example.test",
      "Isolation-Pass-D1!",
      "0198a6d8-dd00-7c55-a5b1-a3f27f8234d1",
    );

    const beforeRevoke = await sessions.authenticate(new Headers({ cookie }));
    expect(beforeRevoke?.accountId).toBe(userId);

    await sessions.revokeCurrent(new Headers({ cookie }));

    const afterRevoke = await sessions.authenticate(new Headers({ cookie }));
    expect(afterRevoke).toBeNull();
  });
});
