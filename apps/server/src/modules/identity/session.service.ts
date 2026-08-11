import { randomBytes, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import { BETTER_AUTH_SESSION_COOKIE, type createBetterAuthAdapter } from "./better-auth.adapter.js";

const ABSOLUTE_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
// Stay below database's hard ten-minute ceiling despite cross-process clock precision/skew.
const REAUTH_GRANT_MAX_AGE_MS = 10 * 60 * 1_000 - 1_000;

type BetterAuthAdapter = ReturnType<typeof createBetterAuthAdapter>;

export interface ReauthGrant {
  readonly grantId: string;
  readonly expiresAt: Date;
  readonly scope: readonly string[];
}

export interface SessionContext {
  readonly accountId: string;
  readonly sessionId: string;
}

export interface SessionServiceOptions {
  auth: BetterAuthAdapter;
  pool: Pool;
}

export class SessionService {
  private readonly auth: BetterAuthAdapter;
  private readonly pool: Pool;

  constructor(options: Readonly<SessionServiceOptions>) {
    this.auth = options.auth;
    this.pool = options.pool;
  }

  async authenticate(requestHeaders: Headers): Promise<SessionContext | null> {
    const session = await this.auth.api.getSession({ headers: requestHeaders });
    if (session === null) return null;

    const age = Date.now() - session.session.createdAt.getTime();
    if (age >= ABSOLUTE_SESSION_AGE_MS) {
      await this.auth.api.revokeSession({
        headers: requestHeaders,
        body: { token: session.session.token },
      });
      return null;
    }

    return { accountId: session.user.id, sessionId: session.session.id };
  }

  async revokeCurrent(requestHeaders: Headers): Promise<void> {
    await this.auth.api.signOut({ headers: requestHeaders });
  }

  async revokeOtherSessions(requestHeaders: Headers): Promise<void> {
    await this.auth.api.revokeOtherSessions({ headers: requestHeaders });
  }

  async revokeAllSessions(requestHeaders: Headers): Promise<void> {
    await this.auth.api.revokeSessions({ headers: requestHeaders });
  }

  async createReauthGrant(
    accountId: string,
    sessionId: string,
    scope: readonly string[],
  ): Promise<ReauthGrant> {
    const grantId = randomUUID();
    const tokenHash = randomBytes(32);
    const expiresAt = new Date(Date.now() + REAUTH_GRANT_MAX_AGE_MS);

    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      await transaction.query(
        `INSERT INTO reauth_grants (id, user_id, session_id, token_hash, scope, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [grantId, accountId, sessionId, tokenHash, scope, expiresAt],
      );
    });

    return { grantId, expiresAt, scope };
  }

  async consumeReauthGrant(
    grantId: string,
    accountId: string,
    sessionId: string,
    requiredScope?: string,
  ): Promise<boolean> {
    if (requiredScope !== undefined) {
      const scoped = await withAccountTransaction(this.pool, accountId, (transaction) =>
        transaction.query(
          `UPDATE reauth_grants
              SET used_at = now()
            WHERE id = $1
              AND user_id = $2
              AND session_id = $3
              AND used_at IS NULL
              AND expires_at > now()
              AND $4::reauth_scope = ANY(scope)`,
          [grantId, accountId, sessionId, requiredScope],
        ),
      );
      return (scoped.rowCount ?? 0) > 0;
    }
    const result = await withAccountTransaction(this.pool, accountId, (transaction) =>
      transaction.query(
        `UPDATE reauth_grants
            SET used_at = now()
          WHERE id = $1
            AND user_id = $2
            AND session_id = $3
            AND used_at IS NULL
            AND expires_at > now()`,
        [grantId, accountId, sessionId],
      ),
    );
    return (result.rowCount ?? 0) > 0;
  }

  async invalidateReauthGrantsForSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE reauth_grants SET used_at = now()
       WHERE session_id = $1 AND used_at IS NULL`,
      [sessionId],
    );
  }

  cookieName(): string {
    return BETTER_AUTH_SESSION_COOKIE;
  }
}
