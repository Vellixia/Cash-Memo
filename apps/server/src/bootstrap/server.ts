import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import Fastify from "fastify";

import { parseEnvironment } from "./environment.schema.js";
import { createBetterAuthAdapter } from "../modules/identity/better-auth.adapter.js";
import { IdentityService } from "../modules/identity/identity.service.js";
import { SessionService } from "../modules/identity/session.service.js";
import { OnboardingService } from "../modules/onboarding/onboarding.service.js";

void dirname(fileURLToPath(import.meta.url));

async function main() {
  const env = parseEnvironment(process.env);
  const port = env.PORT;

  const identityPool = new Pool({
    connectionString: env.AUTH_DATABASE_URL,
    max: 10,
    options: "-c role=cashmemo_identity",
  });

  const runtimePool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    options: "-c role=cashmemo_runtime",
  });

  const deliveryCallbacks = {
    sendPasswordReset: async ({
      destination,
      oneTimeUrl,
    }: {
      destination: string;
      oneTimeUrl: string;
    }) => {
      const mailpitUrl = "http://127.0.0.1:8025";
      await fetch(`${mailpitUrl}/api/v1/send`, {
        body: JSON.stringify({
          From: env.SES_FROM_ADDRESS,
          Subject: "Reset your Cashmemo password",
          Text: `Use this link to reset your password:\n\n${oneTimeUrl}\n\nThis link expires in 1 hour.`,
          To: [destination],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    },
    sendVerification: async ({
      destination,
      oneTimeUrl,
    }: {
      destination: string;
      oneTimeUrl: string;
    }) => {
      const mailpitUrl = "http://127.0.0.1:8025";
      await fetch(`${mailpitUrl}/api/v1/send`, {
        body: JSON.stringify({
          From: env.SES_FROM_ADDRESS,
          Subject: "Verify your Cashmemo email address",
          Text: `Use this link to verify your email address:\n\n${oneTimeUrl}\n\nThis link expires in 24 hours.`,
          To: [destination],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    },
  };

  const auth = createBetterAuthAdapter({
    baseURL: env.APP_ORIGIN,
    delivery: deliveryCallbacks,
    identityPool,
    secret: env.AUTH_SESSION_SECRET,
    trustedOrigins: [env.APP_ORIGIN],
  });

  const identity = new IdentityService({
    auth,
    idempotencyHmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
    identityPool,
    runtimePool,
  });

  const sessions = new SessionService({ auth, pool: runtimePool });
  const onboarding = new OnboardingService({ pool: runtimePool });

  const app = Fastify({ logger: false });

  // CORS for development
  await app.register(import("@fastify/cors"), {
    credentials: true,
    origin: [env.APP_ORIGIN, "http://localhost:5173", "https://localhost:5173"],
  });

  // ─── Custom auth endpoints that use the identity service ───

  app.post("/api/v1/auth/sign-up", async (request, reply) => {
    try {
      const body = request.body as { email: string; idempotencyKey: string; password: string };
      const result = await identity.signUp(body);
      reply.code(202).send(result);
    } catch {
      reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/v1/auth/verification/resend", async (request, reply) => {
    try {
      const body = request.body as { email: string };
      const result = await identity.resendVerification(body);
      reply.code(202).send(result);
    } catch {
      reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/v1/auth/verify-email", async (request, reply) => {
    try {
      const body = request.body as { token: string };
      await identity.verifyEmail(body);
      reply.code(204).send();
    } catch {
      reply.code(400).send({ messageCode: "AUTH_ACTION_INVALID" });
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    try {
      const body = request.body as { email: string; password: string };
      const result = await identity.login(body);
      const setCookie = result.responseHeaders.getSetCookie();
      for (const cookie of setCookie) {
        reply.header("set-cookie", cookie);
      }
      reply.code(200).send(result.session);
    } catch (error) {
      if (error instanceof Error && error.name === "IdentityServiceError") {
        const code = error.message;
        if (code === "EMAIL_NOT_VERIFIED") reply.code(403).send({ messageCode: code });
        else if (code === "AUTH_FAILED") reply.code(401).send({ messageCode: code });
        else reply.code(503).send({ messageCode: code });
      } else {
        reply.code(500).send({ error: "INTERNAL_ERROR" });
      }
    }
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    await identity.logout(headers);
    reply.code(204).send();
  });

  app.get("/api/v1/auth/session", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    try {
      const session = await auth.api.getSession({ headers });
      if (session === null) {
        reply.code(401).send();
        return;
      }
      reply.code(200).send({
        absoluteExpiresAt: new Date(
          session.session.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        createdAt: session.session.createdAt.toISOString(),
        idleExpiresAt: session.session.expiresAt.toISOString(),
        sessionId: session.session.id,
        userId: session.user.id,
      });
    } catch {
      reply.code(401).send();
    }
  });

  app.post("/api/v1/auth/password-reset/request", async (request, reply) => {
    try {
      const body = request.body as { email: string };
      const result = await identity.requestPasswordReset(body);
      reply.code(202).send(result);
    } catch {
      reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  app.post("/api/v1/auth/password-reset/complete", async (request, reply) => {
    try {
      const body = request.body as { newPassword: string; token: string };
      await identity.completePasswordReset(body);
      reply.code(204).send();
    } catch {
      reply.code(400).send({ messageCode: "AUTH_ACTION_INVALID" });
    }
  });

  // Better Auth handler for internal routes (verification callback, etc.)
  app.all("/api/v1/auth/*", async (request, reply) => {
    const baseUrl = env.APP_ORIGIN;
    const url = new URL(request.url, baseUrl);
    const reqPath = url.pathname.replace("/api/v1", "");

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : JSON.stringify(request.body);

    const init: RequestInit = {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    };

    const fetchRequest = new Request(`https://cashmemo.test${reqPath}`, init);

    try {
      const response = await auth.handler(fetchRequest);

      for (const [key, value] of response.headers.entries()) {
        reply.header(key, value);
      }
      reply.code(response.status);
      if (response.body !== null) {
        const text = await response.text();
        reply.send(text);
      } else {
        reply.send();
      }
    } catch {
      reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  // Me endpoint
  app.get("/api/v1/me", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const profile = await onboarding.getProfile(ctx.accountId);
    const preferences = await onboarding.getPreferences(ctx.accountId);
    reply.code(200).send({
      accountStatus: "active",
      emailVerified: true,
      onboardingState: profile.onboardingState,
      preferences:
        preferences === null
          ? null
          : {
              defaultCurrency: preferences.defaultCurrency,
              locale: preferences.locale,
              reportingTimezone: preferences.reportingTimezone,
              revision: preferences.revision,
              timezoneBoundaryWarningRequired: false,
            },
      profileRevision: "1",
      userId: ctx.accountId,
    });
  });

  // Complete onboarding
  app.put("/api/v1/me/onboarding", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const body = request.body as {
      defaultCurrency: string;
      locale: string;
      privacyNoticeVersion: string;
      reportingTimezone: string;
    };
    await onboarding.completeOnboarding(ctx.accountId, body.privacyNoticeVersion);
    await onboarding.seedStarterLabels(ctx.accountId);
    reply.code(200).send({
      accountStatus: "active",
      emailVerified: true,
      onboardingState: "complete",
      preferences: null,
      profileRevision: "2",
      userId: ctx.accountId,
    });
  });

  // Preferences
  app.get("/api/v1/me/preferences", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const prefs = await onboarding.getPreferences(ctx.accountId);
    if (prefs === null) {
      reply.code(404).send();
      return;
    }
    reply.code(200).send({
      defaultCurrency: prefs.defaultCurrency,
      locale: prefs.locale,
      reportingTimezone: prefs.reportingTimezone,
      revision: prefs.revision,
      timezoneBoundaryWarningRequired: false,
    });
  });

  // Health
  app.get("/api/v1/health", () => {
    return { status: "ok" };
  });

  await app.listen({ host: "0.0.0.0", port });
  console.log(`Server listening on port ${String(port)}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "SERVER_STARTUP_FAILED");
  process.exitCode = 1;
});
