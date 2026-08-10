import type { IdentityService, SessionView } from "./identity.service.js";
import type { SessionService } from "./session.service.js";

export interface IdentityControllerDeps {
  identity: IdentityService;
  sessions: SessionService;
}

export function createIdentityController(deps: Readonly<IdentityControllerDeps>) {
  return {
    async signUp(body: { email: string; idempotencyKey: string; password: string }) {
      return deps.identity.signUp(body);
    },

    async resendVerification(body: { email: string }) {
      return deps.identity.resendVerification(body);
    },

    async verifyEmail(body: { token: string }) {
      await deps.identity.verifyEmail(body);
    },

    async login(body: {
      email: string;
      password: string;
    }): Promise<{ body: SessionView; headers: Record<string, string> }> {
      const result = await deps.identity.login(body);
      const setCookie = result.responseHeaders.getSetCookie();
      return {
        body: result.session,
        headers: Object.fromEntries(
          setCookie.map((cookie) => {
            const [name, ...rest] = cookie.split("=");
            return [name ?? "set-cookie", rest.join("=")];
          }),
        ),
      };
    },

    async getSession(requestHeaders: Headers): Promise<SessionView | null> {
      const ctx = await deps.sessions.authenticate(requestHeaders);
      if (ctx === null) return null;
      return {
        absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        idleExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        sessionId: ctx.sessionId,
        userId: ctx.accountId,
      };
    },

    async logout(requestHeaders: Headers): Promise<{ headers: Record<string, string> }> {
      const result = await deps.identity.logout(requestHeaders);
      const setCookie = result.responseHeaders.getSetCookie();
      return {
        headers: Object.fromEntries(
          setCookie.map((cookie) => {
            const [name, ...rest] = cookie.split("=");
            return [name ?? "set-cookie", rest.join("=")];
          }),
        ),
      };
    },

    async requestPasswordReset(body: { email: string }) {
      return deps.identity.requestPasswordReset(body);
    },

    async completePasswordReset(body: { newPassword: string; token: string }) {
      await deps.identity.completePasswordReset(body);
    },

    async reauthenticate(requestHeaders: Headers, body: { password: string; scopes: string[] }) {
      const ctx = await deps.sessions.authenticate(requestHeaders);
      if (ctx === null) throw new Error("UNAUTHENTICATED");
      const grant = await deps.sessions.createReauthGrant(
        ctx.accountId,
        ctx.sessionId,
        body.scopes,
      );
      return {
        expiresAt: grant.expiresAt.toISOString(),
        reauthGrant: grant.grantId,
        scopes: grant.scope,
      };
    },

    async revokeOtherSessions(requestHeaders: Headers) {
      await deps.sessions.revokeOtherSessions(requestHeaders);
    },
  };
}
