import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  BETTER_AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS,
  BETTER_AUTH_SESSION_COOKIE,
  BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
} from "../../apps/server/src/modules/identity/better-auth.adapter.js";
import {
  allowedOrigins,
  requireSameOrigin,
} from "../../apps/server/src/adapters/http/security-boundary.js";

const repo = new URL("../../", import.meta.url);
const adapterSource = await readFile(
  new URL("apps/server/src/modules/identity/better-auth.adapter.ts", repo),
  "utf8",
);
const sessionSource = await readFile(
  new URL("apps/server/src/modules/identity/session.service.ts", repo),
  "utf8",
);
const identitySource = await readFile(
  new URL("apps/server/src/modules/identity/identity.service.ts", repo),
  "utf8",
);

describe("authentication security contract", () => {
  it("uses a seven-day idle session and an explicit thirty-day absolute limit", () => {
    expect(BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(sessionSource).toContain("30 * 24 * 60 * 60 * 1_000");
    expect(sessionSource).toContain("revokeSession");
  });

  it("uses a host-only secure HttpOnly SameSite=Lax cookie", () => {
    expect(BETTER_AUTH_SESSION_COOKIE.startsWith("__Host-")).toBe(true);
    expect(adapterSource).toMatch(/httpOnly:\s*true/u);
    expect(adapterSource).toMatch(/sameSite:\s*"lax"/u);
    expect(adapterSource).toMatch(/secure:\s*true/u);
    expect(adapterSource).toMatch(/path:\s*"\/"/u);
    expect(adapterSource).not.toMatch(/domain:/u);
    expect(adapterSource).toContain("crossSubDomainCookies: { enabled: false }");
  });

  it("provides current, other, and all-session revocation", () => {
    expect(sessionSource).toContain("signOut");
    expect(sessionSource).toContain("revokeOtherSessions");
    expect(sessionSource).toContain("revokeSessions");
  });

  it("keeps cookie sessions server authoritative and rejects stale cookies", () => {
    expect(adapterSource).toContain("cookieCache: { enabled: false }");
    expect(sessionSource).toContain("if (session === null) return null");
  });

  it("enforces same-origin mutation policy and production origin fail-closed behavior", () => {
    const configuration = {
      appOrigin: "https://cashmemo.example",
      environment: "production",
    } as const;
    expect(allowedOrigins(configuration)).toEqual(["https://cashmemo.example"]);
    expect(
      requireSameOrigin({ configuration, method: "POST", origin: "https://cashmemo.example" }),
    ).toBe("allowed");
    expect(
      requireSameOrigin({ configuration, method: "POST", origin: "https://other.example" }),
    ).toBe("blocked");
    expect(requireSameOrigin({ configuration, method: "POST", origin: undefined })).toBe("blocked");
  });

  it("stores verification identifiers hashed and disables automatic sign-in", () => {
    expect(adapterSource).toContain('storeIdentifier: "hashed"');
    expect(adapterSource).toContain("autoSignInAfterVerification: false");
    expect(identitySource).toContain("verifyEmail");
  });

  it("expires password-reset tokens, revokes sessions, and does not replay them", () => {
    expect(BETTER_AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS).toBe(60 * 60);
    expect(adapterSource).toContain("revokeSessionsOnPasswordReset: true");
    expect(identitySource).toContain("resetPassword");
  });

  it("uses enumeration-safe outward product codes", () => {
    expect(identitySource).toContain("CHECK_EMAIL_IF_ELIGIBLE");
    expect(identitySource).not.toMatch(/USER_EXISTS|EMAIL_NOT_FOUND/u);
  });

  it("never enables Better Auth request logging or IP tracking", () => {
    expect(adapterSource).toContain("logger: { disabled: true }");
    expect(adapterSource).toContain("ipAddress: { disableIpTracking: true }");
  });

  it("does not send session, reset, or verification tokens to telemetry", async () => {
    const telemetry = await readFile(
      new URL("apps/server/src/adapters/telemetry/safe-telemetry.ts", repo),
      "utf8",
    );
    expect(telemetry).not.toMatch(/\b(token|cookie|email|sessionId)\??:/u);
    expect(telemetry).not.toContain("JSON.stringify");
  });
});
