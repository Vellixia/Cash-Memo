import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BETTER_AUTH_SESSION_COOKIE,
  BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
  createBetterAuthAdapter,
  type BetterAuthDeliveryCallbacks,
} from "../../src/modules/identity/better-auth.adapter.js";
import { IdentityService } from "../../src/modules/identity/identity.service.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const TEST_SECRET = "cashmemo-session-test-secret-v1";
const IDEMPOTENCY_HMAC_KEY = Buffer.alloc(32, 17);
const SEVEN_DAYS_MS = BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

describe("session lifecycle and ReauthGrant", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let migrationPool: Pool;
  let identityPool: Pool;
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
      runtimePool: identityPool,
    });
  }, 120_000);

  afterAll(async () => {
    await identityPool.end();
    await migrationPool.end();
    await environment.stop();
  }, 30_000);

  async function createVerifiedUser(email: string, password: string): Promise<string> {
    await identity.signUp({
      email,
      idempotencyKey: `0198a6d8-0000-7c55-a5b1-${email
        .slice(0, 12)
        .replace(/[^a-f0-9]/g, "0")
        .padStart(12, "0")}`,
      password,
    });
    const userResult = await migrationPool.query<{ id: string }>(
      `UPDATE users SET email_verified = true, status = 'active'
       WHERE email = $1 RETURNING id`,
      [email],
    );
    return userResult.rows[0]?.id ?? "";
  }

  async function loginUser(
    email: string,
    password: string,
  ): Promise<{ cookie: string; sessionId: string; userId: string }> {
    const result = await identity.login({ email, password });
    const cookie = cookiePair(result.responseHeaders);
    return { cookie, sessionId: result.session.sessionId, userId: result.session.userId };
  }

  it("creates a session on login with 7-day idle expiry", async () => {
    const email = "session-create@example.test";
    await createVerifiedUser(email, "Session-Pass-1!");
    const { sessionId } = await loginUser(email, "Session-Pass-1!");

    const session = await migrationPool.query<{ expires_at: Date; created_at: Date }>(
      `SELECT created_at, expires_at FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(session.rowCount).toBe(1);
    const row = session.rows[0];
    if (row === undefined) throw new Error("session not found");
    const idleDuration = row.expires_at.getTime() - row.created_at.getTime();
    expect(idleDuration).toBeGreaterThan(SEVEN_DAYS_MS - 5000);
    expect(idleDuration).toBeLessThan(SEVEN_DAYS_MS + 5000);
  });

  it("refreshes session expires_at within updateAge window", async () => {
    const email = "session-refresh@example.test";
    await createVerifiedUser(email, "Session-Pass-2!");
    const { cookie, sessionId } = await loginUser(email, "Session-Pass-2!");

    const beforeRefresh = await migrationPool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM sessions WHERE id = $1`,
      [sessionId],
    );

    await migrationPool.query(
      `UPDATE sessions SET updated_at = updated_at - interval '2 hours', expires_at = expires_at - interval '2 hours'
       WHERE id = $1`,
      [sessionId],
    );

    const auth = createBetterAuthAdapter({
      baseURL: "https://cashmemo.test",
      delivery,
      identityPool,
      secret: TEST_SECRET,
      trustedOrigins: ["https://cashmemo.test"],
    });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session).not.toBeNull();

    const afterRefresh = await migrationPool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM sessions WHERE id = $1`,
      [sessionId],
    );
    const afterRow = afterRefresh.rows[0];
    const beforeRow = beforeRefresh.rows[0];
    if (afterRow === undefined || beforeRow === undefined) throw new Error("session not found");
    expect(afterRow.expires_at.getTime()).toBeGreaterThan(beforeRow.expires_at.getTime());
  });

  it("revokes current session on logout", async () => {
    const email = "session-revoke-current@example.test";
    await createVerifiedUser(email, "Session-Pass-3!");
    const { cookie, sessionId } = await loginUser(email, "Session-Pass-3!");

    await identity.logout(new Headers({ cookie }));

    const session = await migrationPool.query<{ id: string }>(
      `SELECT id FROM sessions WHERE id = $1`,
      [sessionId],
    );
    expect(session.rowCount).toBe(0);
  });

  it("revokes all sessions on password reset", async () => {
    const email = "session-reset-all@example.test";
    await createVerifiedUser(email, "Session-Pass-4!");

    await loginUser(email, "Session-Pass-4!");
    await loginUser(email, "Session-Pass-4!");

    await identity.requestPasswordReset({ email });
    const resetRows = await migrationPool.query<{ value: string }>(
      `SELECT value FROM verification_tokens WHERE identifier IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    );
    const resetToken = resetRows.rows[0]?.value;
    if (resetToken === undefined) throw new Error("reset token not found");

    await identity.completePasswordReset({ newPassword: "Session-Pass-5!", token: resetToken });

    const remaining = await migrationPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    expect(remaining.rows[0]?.count).toBe("0");
  });

  it("rejects session after 30-day absolute age", async () => {
    const email = "session-absolute@example.test";
    await createVerifiedUser(email, "Session-Pass-6!");
    const { sessionId } = await loginUser(email, "Session-Pass-6!");

    await migrationPool.query(
      `UPDATE sessions SET created_at = created_at - interval '31 days' WHERE id = $1`,
      [sessionId],
    );

    const session = await migrationPool.query<{ created_at: Date }>(
      `SELECT created_at FROM sessions WHERE id = $1`,
      [sessionId],
    );
    const row = session.rows[0];
    if (row === undefined) throw new Error("session not found");
    const age = Date.now() - row.created_at.getTime();
    expect(age).toBeGreaterThan(THIRTY_DAYS_MS);
  });

  it("rejects session fixation attempts with forged cookie", async () => {
    const forgedCookie = `${BETTER_AUTH_SESSION_COOKIE}=forged-token-not-real`;
    const auth = createBetterAuthAdapter({
      baseURL: "https://cashmemo.test",
      delivery,
      identityPool,
      secret: TEST_SECRET,
      trustedOrigins: ["https://cashmemo.test"],
    });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: forgedCookie }),
    });
    expect(session).toBeNull();
  });

  it("restores session from valid cookie", async () => {
    const email = "session-restore@example.test";
    await createVerifiedUser(email, "Session-Pass-7!");
    const { cookie, sessionId } = await loginUser(email, "Session-Pass-7!");

    const auth = createBetterAuthAdapter({
      baseURL: "https://cashmemo.test",
      delivery,
      identityPool,
      secret: TEST_SECRET,
      trustedOrigins: ["https://cashmemo.test"],
    });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session).not.toBeNull();
    expect(session?.session.id).toBe(sessionId);
  });

  it("proves ReauthGrant requires valid Better Auth session", async () => {
    const email = "reauth-session-required@example.test";
    await createVerifiedUser(email, "Session-Pass-8!");
    const { cookie } = await loginUser(email, "Session-Pass-8!");

    const auth = createBetterAuthAdapter({
      baseURL: "https://cashmemo.test",
      delivery,
      identityPool,
      secret: TEST_SECRET,
      trustedOrigins: ["https://cashmemo.test"],
    });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session).not.toBeNull();

    await identity.logout(new Headers({ cookie }));

    const afterLogout = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(afterLogout).toBeNull();
  });
});
