import { randomBytes } from "node:crypto";

import { canonicalRequestHmac } from "@cashmemo/domain";
import { APIError } from "better-auth";
import type { Pool, PoolClient } from "pg";

import {
  BETTER_AUTH_COMPATIBILITY_NAME,
  BETTER_AUTH_SESSION_COOKIE,
  type createBetterAuthAdapter,
} from "./better-auth.adapter.js";

const GENERIC_ACCEPTED = {
  messageCode: "CHECK_EMAIL_IF_ELIGIBLE",
  status: "accepted",
} as const;
const SIGNUP_IDEMPOTENCY_RETENTION_DAYS = 35;
const ABSOLUTE_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type BetterAuthAdapter = ReturnType<typeof createBetterAuthAdapter>;

export type IdentityErrorCode =
  "AUTH_ACTION_INVALID" | "AUTH_FAILED" | "AUTH_TEMPORARILY_UNAVAILABLE" | "EMAIL_NOT_VERIFIED";

export class IdentityServiceError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "IdentityServiceError";
  }
}

export interface SessionView {
  absoluteExpiresAt: string;
  createdAt: string;
  idleExpiresAt: string;
  sessionId: string;
  userId: string;
}

export interface LoginResult {
  responseHeaders: Headers;
  session: SessionView;
}

export interface LogoutResult {
  responseHeaders: Headers;
}

export interface IdentityServiceOptions {
  auth: BetterAuthAdapter;
  idempotencyHmacKey: Uint8Array;
  identityPool: Pool;
  runtimePool: Pool;
}

function createUuidV7(): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  const versionSource = bytes[6];
  const variantSource = bytes[8];
  if (versionSource === undefined || variantSource === undefined) {
    throw new Error("UUID_V7_RANDOMNESS_UNAVAILABLE");
  }
  bytes[6] = (versionSource & 0x0f) | 0x70;
  bytes[8] = (variantSource & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function isServerFailure(error: unknown): boolean {
  return error instanceof APIError && error.statusCode >= 500;
}

function isDuplicateEmailError(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === "23505";
}

function unavailable(): IdentityServiceError {
  return new IdentityServiceError("AUTH_TEMPORARILY_UNAVAILABLE", true);
}

function cookiePair(headers: Headers): string {
  const setCookie = headers
    .getSetCookie()
    .find((value) => value.startsWith(`${BETTER_AUTH_SESSION_COOKIE}=`));
  const pair = setCookie?.split(";", 1)[0];
  if (pair === undefined) throw unavailable();
  return pair;
}

function sessionView(session: {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  userId: string;
}): SessionView {
  return {
    absoluteExpiresAt: new Date(
      session.createdAt.getTime() + ABSOLUTE_SESSION_AGE_MS,
    ).toISOString(),
    createdAt: session.createdAt.toISOString(),
    idleExpiresAt: session.expiresAt.toISOString(),
    sessionId: session.id,
    userId: session.userId,
  };
}

async function withSignupLock<T>(
  pool: Pool,
  idempotencyKey: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [idempotencyKey]);
    return await operation(client);
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [idempotencyKey])
      .catch(() => undefined);
    client.release();
  }
}

export class IdentityService {
  private readonly auth: BetterAuthAdapter;
  private readonly idempotencyHmacKey: Uint8Array;
  private readonly identityPool: Pool;

  constructor(options: Readonly<IdentityServiceOptions>) {
    if (options.idempotencyHmacKey.byteLength < 32) {
      throw new Error("IDENTITY_IDEMPOTENCY_HMAC_KEY_TOO_SHORT");
    }
    this.auth = options.auth;
    this.idempotencyHmacKey = options.idempotencyHmacKey;
    this.identityPool = options.identityPool;
    void options.runtimePool; // retained for authenticated session context establishment
  }

  async signUp(input: {
    email: string;
    idempotencyKey: string;
    password: string;
  }): Promise<typeof GENERIC_ACCEPTED> {
    if (!UUID_PATTERN.test(input.idempotencyKey)) {
      throw new IdentityServiceError("AUTH_ACTION_INVALID", false);
    }
    const email = normalizeEmail(input.email);
    const requestHmac = canonicalRequestHmac({
      hmacKey: this.idempotencyHmacKey,
      operation: "signup",
      payload: { email },
      schemaVersion: "identity-signup-v1",
    });

    try {
      return await withSignupLock(this.identityPool, input.idempotencyKey, async (client) => {
        const existing = await client.query<{ request_hmac: Buffer }>(
          `SELECT request_hmac
             FROM idempotency_records
            WHERE operation = 'signup_side_effect' AND key = $1
            LIMIT 1`,
          [input.idempotencyKey],
        );
        if (existing.rowCount !== 0) return GENERIC_ACCEPTED;

        let userId: string;
        try {
          const result = await this.auth.api.signUpEmail({
            body: { email, name: BETTER_AUTH_COMPATIBILITY_NAME, password: input.password },
          });
          userId = result.user.id;
          await client.query(
            `INSERT INTO idempotency_records
               (id, user_id, operation, key, request_hmac, state, result_type,
                 result_id, response_code, expires_at)
             VALUES ($1, $2, 'signup_side_effect', $3, $4, 'succeeded', 'user',
                     $2, 'accepted', now() + make_interval(days => $5))
             ON CONFLICT (user_id, operation, key) DO NOTHING`,
            [
              createUuidV7(),
              userId,
              input.idempotencyKey,
              Buffer.from(requestHmac, "hex"),
              SIGNUP_IDEMPOTENCY_RETENTION_DAYS,
            ],
          );
        } catch (error) {
          if (error instanceof IdentityServiceError) throw error;
          if (isServerFailure(error) && !isDuplicateEmailError(error)) throw unavailable();
          return GENERIC_ACCEPTED;
        }
        return GENERIC_ACCEPTED;
      });
    } catch (error) {
      if (error instanceof IdentityServiceError) throw error;
      throw unavailable();
    }
  }

  async resendVerification(input: { email: string }): Promise<typeof GENERIC_ACCEPTED> {
    try {
      await this.auth.api.sendVerificationEmail({ body: { email: normalizeEmail(input.email) } });
    } catch (error) {
      if (isServerFailure(error)) throw unavailable();
    }
    return GENERIC_ACCEPTED;
  }

  async verifyEmail(input: { token: string }): Promise<void> {
    try {
      const result = await this.auth.api.verifyEmail({ query: { token: input.token } });
      if (!result?.status) {
        throw new IdentityServiceError("AUTH_ACTION_INVALID", false);
      }
    } catch (error) {
      if (error instanceof IdentityServiceError) throw error;
      if (isServerFailure(error)) throw unavailable();
      throw new IdentityServiceError("AUTH_ACTION_INVALID", false);
    }
  }

  async login(input: { email: string; password: string }): Promise<LoginResult> {
    try {
      const result = await this.auth.api.signInEmail({
        body: { email: normalizeEmail(input.email), password: input.password },
        returnHeaders: true,
      });
      const responseHeaders = result.headers;
      const session = await this.auth.api.getSession({
        headers: new Headers({ cookie: cookiePair(responseHeaders) }),
      });
      if (session === null) throw unavailable();
      await this.identityPool.query(
        `UPDATE users
            SET status = 'active', revision = revision + 1, updated_at = now()
          WHERE id = $1 AND email_verified = true AND status = 'pending_verification'`,
        [session.user.id],
      );
      return { responseHeaders, session: sessionView(session.session) };
    } catch (error) {
      if (error instanceof IdentityServiceError) throw error;
      if (isServerFailure(error)) throw unavailable();
      if (error instanceof APIError && error.statusCode === 403) {
        throw new IdentityServiceError("EMAIL_NOT_VERIFIED", false);
      }
      throw new IdentityServiceError("AUTH_FAILED", false);
    }
  }

  async verifyPasswordForAccount(accountId: string, password: string): Promise<boolean> {
    if (!UUID_PATTERN.test(accountId) || password.length === 0) return false;
    try {
      const account = await this.identityPool.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1",
        [accountId],
      );
      const email = account.rows[0]?.email;
      if (email === undefined) return false;
      const result = await this.auth.api.signInEmail({
        body: { email, password },
        returnHeaders: true,
      });
      const cookie = cookiePair(result.headers);
      const temporaryHeaders = new Headers({ cookie });
      const verified = await this.auth.api.getSession({ headers: temporaryHeaders });
      await this.auth.api.signOut({ headers: temporaryHeaders }).catch(() => undefined);
      return verified?.user.id === accountId;
    } catch {
      return false;
    }
  }

  async logout(requestHeaders: Headers): Promise<LogoutResult> {
    try {
      const result = await this.auth.api.signOut({ headers: requestHeaders, returnHeaders: true });
      return { responseHeaders: result.headers };
    } catch (error) {
      if (isServerFailure(error)) throw unavailable();
      throw new IdentityServiceError("AUTH_FAILED", false);
    }
  }

  async requestPasswordReset(input: { email: string }): Promise<typeof GENERIC_ACCEPTED> {
    try {
      await this.auth.api.requestPasswordReset({ body: { email: normalizeEmail(input.email) } });
    } catch (error) {
      if (isServerFailure(error)) throw unavailable();
    }
    return GENERIC_ACCEPTED;
  }

  async completePasswordReset(input: { newPassword: string; token: string }): Promise<void> {
    try {
      await this.auth.api.resetPassword({
        body: { newPassword: input.newPassword, token: input.token },
      });
    } catch (error) {
      if (isServerFailure(error)) throw unavailable();
      throw new IdentityServiceError("AUTH_ACTION_INVALID", false);
    }
  }
}
