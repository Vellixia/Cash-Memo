import { createHash } from "node:crypto";

import { createEmailVerificationToken } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestEnvironment,
  type TestEnvironment,
} from "../../apps/server/tests/integration/support/test-environment.js";
import { applyMigrations } from "../../apps/server/tests/integration/support/postgres-migrations.js";
import {
  BETTER_AUTH_COMPATIBILITY_NAME,
  BETTER_AUTH_SESSION_COOKIE,
  BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
  BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
  createBetterAuthAdapter,
} from "../../apps/server/src/modules/identity/better-auth.adapter.js";

const SEVEN_DAYS_SECONDS = BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS;
const ONE_HOUR_SECONDS = BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS;
const TEST_SECRET = "cashmemo-better-auth-compatibility-secret-v1";
const ORIGINAL_PASSWORD = "Synthetic-Password-1!";
const RESET_PASSWORD = "Synthetic-Password-2!";
const COMPATIBILITY_NAME = BETTER_AUTH_COMPATIBILITY_NAME;

interface DeliveryCapture {
  resetTokens: string[];
  verificationTokens: string[];
}

function createCompatibilityAuth(pool: Pool, delivery: DeliveryCapture) {
  return createBetterAuthAdapter({
    baseURL: "https://cashmemo.test",
    delivery: {
      sendPasswordReset: ({ token }) => {
        delivery.resetTokens.push(token);
        return Promise.resolve();
      },
      sendVerification: ({ token }) => {
        delivery.verificationTokens.push(token);
        return Promise.resolve();
      },
    },
    identityPool: pool,
    secret: TEST_SECRET,
    trustedOrigins: ["https://cashmemo.test"],
  });
}

function cookieHeader(headers: Headers): { cookie: string; setCookie: string } {
  const setCookie = headers
    .getSetCookie()
    .find((value) => value.includes(`${BETTER_AUTH_SESSION_COOKIE}=`));
  if (setCookie === undefined) throw new Error("BETTER_AUTH_SESSION_COOKIE_MISSING");
  const pair = setCookie.split(";", 1)[0];
  if (pair === undefined) throw new Error("BETTER_AUTH_SESSION_COOKIE_INVALID");
  return { cookie: pair, setCookie };
}

function expectColumns(
  byTable: ReadonlyMap<string, ReadonlySet<string>>,
  table: string,
  required: readonly string[],
): void {
  const columns = byTable.get(table);
  if (columns === undefined) throw new Error(`BETTER_AUTH_TABLE_MISSING:${table}`);
  expect(required.filter((column) => !columns.has(column))).toEqual([]);
}

async function signUpAndVerify(
  auth: ReturnType<typeof createCompatibilityAuth>,
  delivery: DeliveryCapture,
  email: string,
): Promise<void> {
  await auth.api.signUpEmail({
    body: { email, name: COMPATIBILITY_NAME, password: ORIGINAL_PASSWORD },
  });
  const token = delivery.verificationTokens.shift();
  if (token === undefined) throw new Error("VERIFICATION_TOKEN_NOT_CAPTURED");
  await auth.api.verifyEmail({ query: { token } });
  await expect(auth.api.verifyEmail({ query: { token } })).resolves.toMatchObject({ user: null });
}

async function signIn(
  auth: ReturnType<typeof createCompatibilityAuth>,
  email: string,
  password = ORIGINAL_PASSWORD,
): Promise<{ cookie: string; sessionToken: string }> {
  const result = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = cookieHeader(result.headers);
  expect(cookie.setCookie).toContain("; HttpOnly");
  expect(cookie.setCookie).toContain("; Secure");
  expect(cookie.setCookie).toContain("; SameSite=Lax");
  expect(cookie.setCookie).toContain("; Path=/");
  expect(cookie.setCookie).not.toContain("; Domain=");
  return {
    cookie: cookie.cookie,
    sessionToken: result.response.token,
  };
}

describe("Better Auth 1.6.26 PostgreSQL compatibility", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let pool: Pool;
  let delivery: DeliveryCapture;
  let auth: ReturnType<typeof createCompatibilityAuth>;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    pool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(pool);
    delivery = { resetTokens: [], verificationTokens: [] };
    auth = createCompatibilityAuth(pool, delivery);
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await environment.stop();
  });

  it("requires the committed Cashmemo identity schema to need no unplanned Better Auth migration", async () => {
    const migrations = await getMigrations(auth.options);
    const sql = await migrations.compileMigrations();
    expect(sql.replace(/[;\s]/gu, "")).toBe("");
  });

  it("matches supported core schema and session query APIs without a custom token adapter", async () => {
    const columns = await pool.query<{ column_name: string; table_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'sessions', 'credential_accounts', 'verification_tokens')`,
    );
    const byTable = new Map<string, Set<string>>();
    for (const column of columns.rows) {
      const names = byTable.get(column.table_name) ?? new Set<string>();
      names.add(column.column_name);
      byTable.set(column.table_name, names);
    }
    expectColumns(byTable, "users", [
      "id",
      "name",
      "email",
      "email_verified",
      "image",
      "created_at",
      "updated_at",
    ]);
    expectColumns(byTable, "sessions", [
      "id",
      "user_id",
      "token",
      "expires_at",
      "created_at",
      "updated_at",
    ]);
    expectColumns(byTable, "credential_accounts", [
      "id",
      "user_id",
      "account_id",
      "provider",
      "password_hash",
      "access_token",
      "refresh_token",
      "id_token",
    ]);
    expectColumns(byTable, "verification_tokens", [
      "id",
      "identifier",
      "value",
      "expires_at",
      "created_at",
      "updated_at",
    ]);

    expect(auth.api.getSession).toBeTypeOf("function");
    expect(auth.api.revokeSession).toBeTypeOf("function");
    expect(auth.api.revokeOtherSessions).toBeTypeOf("function");
    expect(auth.api.revokeSessions).toBeTypeOf("function");
  });

  it("uses boolean verification authority, a neutral server name, and no verification row", async () => {
    const email = "verification@example.test";
    await auth.api.signUpEmail({
      body: { email, name: COMPATIBILITY_NAME, password: ORIGINAL_PASSWORD },
    });
    const created = await pool.query<{
      email_verified: boolean;
      image: string | null;
      name: string;
    }>(`SELECT name, email_verified, image FROM users WHERE email = $1`, [email]);
    expect(created.rows).toEqual([
      { email_verified: false, image: null, name: COMPATIBILITY_NAME },
    ]);
    const credential = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM credential_accounts WHERE user_id =
         (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    const passwordHash = credential.rows[0]?.password_hash;
    expect(passwordHash).toMatch(
      /^\$argon2id\$v=19\$(?=[^$]*m=19456)(?=[^$]*t=2)(?=[^$]*p=1)[^$]+\$/u,
    );
    expect(passwordHash).not.toContain(ORIGINAL_PASSWORD);
    await expect(
      pool.query(`SELECT email_verified_at FROM users WHERE email = $1`, [email]),
    ).rejects.toMatchObject({ code: "42703" });
    await expect(
      pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM verification_tokens`),
    ).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(
      auth.api.signInEmail({ body: { email, password: ORIGINAL_PASSWORD } }),
    ).rejects.toBeDefined();

    const token = delivery.verificationTokens.shift();
    if (token === undefined) throw new Error("VERIFICATION_TOKEN_NOT_CAPTURED");
    await auth.api.verifyEmail({ query: { token } });
    await expect(auth.api.verifyEmail({ query: { token } })).resolves.toMatchObject({ user: null });
    await expect(
      pool.query<{ email_verified: boolean }>(`SELECT email_verified FROM users WHERE email = $1`, [
        email,
      ]),
    ).resolves.toMatchObject({ rows: [{ email_verified: true }] });
    const expiredToken = await createEmailVerificationToken(
      TEST_SECRET,
      "expired@example.test",
      undefined,
      -1,
    );
    await expect(auth.api.verifyEmail({ query: { token: expiredToken } })).rejects.toBeDefined();
    await expect(signIn(auth, email)).resolves.toBeDefined();
  });

  it("uses supported DB session.token, restores sessions, and applies 7-day/1-hour policy", async () => {
    const email = "session-policy@example.test";
    await signUpAndVerify(auth, delivery, email);
    const signedIn = await signIn(auth, email);
    const stored = await pool.query<{
      created_at: Date;
      expires_at: Date;
      token: string;
      updated_at: Date;
    }>(
      `SELECT created_at, expires_at, token, updated_at
       FROM sessions WHERE token = $1`,
      [signedIn.sessionToken],
    );
    const initial = stored.rows[0];
    if (initial === undefined) throw new Error("BETTER_AUTH_SESSION_ROW_MISSING");
    expect(initial.expires_at.getTime() - initial.created_at.getTime()).toBeGreaterThanOrEqual(
      (SEVEN_DAYS_SECONDS - 5) * 1_000,
    );

    const headers = new Headers({ cookie: signedIn.cookie });
    await expect(auth.api.getSession({ headers })).resolves.toMatchObject({
      session: { token: signedIn.sessionToken },
    });

    await pool.query(
      `UPDATE sessions
       SET updated_at = now() - interval '2 hours', expires_at = now() + interval '1 day'
       WHERE token = $1`,
      [signedIn.sessionToken],
    );
    await auth.api.getSession({ headers });
    const refreshed = await pool.query<{ expires_at: Date; updated_at: Date }>(
      `SELECT expires_at, updated_at FROM sessions WHERE token = $1`,
      [signedIn.sessionToken],
    );
    const refreshedRow = refreshed.rows[0];
    if (refreshedRow === undefined) throw new Error("BETTER_AUTH_REFRESHED_SESSION_MISSING");
    expect(refreshedRow.updated_at.getTime()).toBeGreaterThan(initial.updated_at.getTime());
    expect(refreshedRow.expires_at.getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1_000,
    );
  });

  it("supports Cashmemo 30-day absolute-age revocation without custom token lookup", async () => {
    const email = "absolute-expiry@example.test";
    await signUpAndVerify(auth, delivery, email);
    const signedIn = await signIn(auth, email);
    await pool.query(
      `UPDATE sessions SET created_at = now() - interval '31 days' WHERE token = $1`,
      [signedIn.sessionToken],
    );

    const headers = new Headers({ cookie: signedIn.cookie });
    const current = await auth.api.getSession({ headers });
    expect(current).not.toBeNull();
    if (
      current !== null &&
      current.session.createdAt.getTime() + 30 * 24 * 60 * 60 * 1_000 <= Date.now()
    ) {
      await auth.api.revokeSession({ body: { token: current.session.token }, headers });
    }
    await expect(auth.api.getSession({ headers })).resolves.toBeNull();
  });

  it("supports current, other, and all-session revocation", async () => {
    const email = "revocation@example.test";
    await signUpAndVerify(auth, delivery, email);
    const current = await signIn(auth, email);
    const other = await signIn(auth, email);
    const third = await signIn(auth, email);

    await auth.api.revokeSession({
      body: { token: other.sessionToken },
      headers: new Headers({ cookie: current.cookie }),
    });
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: other.cookie }) }),
    ).resolves.toBeNull();

    await auth.api.revokeOtherSessions({ headers: new Headers({ cookie: current.cookie }) });
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: third.cookie }) }),
    ).resolves.toBeNull();
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: current.cookie }) }),
    ).resolves.not.toBeNull();

    const replacement = await signIn(auth, email);
    await auth.api.revokeSessions({ headers: new Headers({ cookie: current.cookie }) });
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: current.cookie }) }),
    ).resolves.toBeNull();
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: replacement.cookie }) }),
    ).resolves.toBeNull();
  });

  it("hashes reset identifiers, consumes once, cleans expiry, and leaves OAuth fields null", async () => {
    const email = "password-reset@example.test";
    await signUpAndVerify(auth, delivery, email);
    const existing = await signIn(auth, email);
    await auth.api.requestPasswordReset({ body: { email } });
    const token = delivery.resetTokens.shift();
    if (token === undefined) throw new Error("RESET_TOKEN_NOT_CAPTURED");
    const expectedIdentifier = createHash("sha256")
      .update(`reset-password:${token}`)
      .digest("base64url");
    const storedReset = await pool.query<{
      expires_at: Date;
      identifier: string;
      value: string;
    }>(
      `SELECT identifier, value, expires_at
       FROM verification_tokens WHERE identifier = $1`,
      [expectedIdentifier],
    );
    const resetRow = storedReset.rows[0];
    if (resetRow === undefined) throw new Error("RESET_VERIFICATION_ROW_MISSING");
    expect(resetRow.identifier).toBe(expectedIdentifier);
    expect(resetRow.identifier).not.toContain(token);
    expect(resetRow.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(resetRow.expires_at.getTime()).toBeLessThanOrEqual(
      Date.now() + (ONE_HOUR_SECONDS + 5) * 1_000,
    );
    expect(resetRow.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(JSON.stringify(storedReset.rows)).not.toContain(token);

    const credentialAccount = await pool.query<{
      access_token: string | null;
      access_token_expires_at: Date | null;
      id_token: string | null;
      refresh_token: string | null;
      refresh_token_expires_at: Date | null;
      scope: string | null;
    }>(
      `SELECT access_token, refresh_token, id_token,
              access_token_expires_at, refresh_token_expires_at, scope
       FROM credential_accounts WHERE user_id = $1`,
      [resetRow.value],
    );
    expect(credentialAccount.rows).toEqual([
      {
        access_token: null,
        access_token_expires_at: null,
        id_token: null,
        refresh_token: null,
        refresh_token_expires_at: null,
        scope: null,
      },
    ]);

    await auth.api.resetPassword({ body: { newPassword: RESET_PASSWORD, token } });
    await expect(
      pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM verification_tokens WHERE identifier = $1`,
        [expectedIdentifier],
      ),
    ).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(
      auth.api.resetPassword({ body: { newPassword: ORIGINAL_PASSWORD, token } }),
    ).rejects.toBeDefined();
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie: existing.cookie }) }),
    ).resolves.toBeNull();
    await expect(signIn(auth, email, RESET_PASSWORD)).resolves.toBeDefined();

    await auth.api.requestPasswordReset({ body: { email } });
    const expiredToken = delivery.resetTokens.shift();
    if (expiredToken === undefined) throw new Error("EXPIRED_RESET_TOKEN_NOT_CAPTURED");
    const expiredIdentifier = createHash("sha256")
      .update(`reset-password:${expiredToken}`)
      .digest("base64url");
    await pool.query(
      `UPDATE verification_tokens
       SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second'
       WHERE identifier = $1`,
      [expiredIdentifier],
    );
    await expect(
      auth.api.resetPassword({ body: { newPassword: ORIGINAL_PASSWORD, token: expiredToken } }),
    ).rejects.toBeDefined();
    await expect(
      pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM verification_tokens WHERE identifier = $1`,
        [expiredIdentifier],
      ),
    ).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("keeps cookie cache, secondary storage, and stateless session mechanisms disabled", () => {
    expect("secondaryStorage" in auth.options).toBe(false);
    expect(auth.options.session).toMatchObject({
      cookieCache: { enabled: false },
      expiresIn: SEVEN_DAYS_SECONDS,
      freshAge: 0,
      updateAge: ONE_HOUR_SECONDS,
    });
    expect(auth.options.database).toBe(pool);
    expect(auth.options.account.storeAccountCookie).toBe(false);
    expect(auth.options.account.storeStateStrategy).toBe("database");
    expect(auth.options.logger).toMatchObject({ disabled: true });
    expect(auth.options.advanced).toMatchObject({
      cookies: {
        session_token: {
          name: BETTER_AUTH_SESSION_COOKIE,
        },
      },
      crossSubDomainCookies: { enabled: false },
      database: { generateId: "uuid" },
    });
    expect(auth.options.account.modelName).toBe("credential_accounts");
  });
});
