import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import Fastify from "fastify";

import { canonicalRequestHmac } from "@cashmemo/domain";
import { FinitePrivacyBoundary } from "@cashmemo/privacy-rules";

import { parseEnvironment } from "./environment.schema.js";
import { createBetterAuthAdapter } from "../modules/identity/better-auth.adapter.js";
import { IdentityService } from "../modules/identity/identity.service.js";
import { SessionService } from "../modules/identity/session.service.js";
import { OnboardingService } from "../modules/onboarding/onboarding.service.js";
import {
  createMoneyMemo,
  updateMoneyMemo,
  getMoneyMemo,
  archiveMoneyMemo,
  restoreArchivedMoneyMemo,
  moveToRecentlyDeleted,
  restoreRecentlyDeleted,
  initiatePurge,
  MoneyMemoServiceError,
} from "../modules/memo/money-memo.service.js";
import { MoneyValidationError } from "@cashmemo/domain";
import { withAccountTransaction } from "../adapters/postgres/transaction-context.js";
import { LabelsService } from "../modules/labels/labels.service.js";
import { registerLabelRoutes } from "../modules/labels/labels.controller.js";
import { SearchRepository } from "../modules/history/search.repository.js";
import { registerHistorySearchRoute } from "../modules/history/history.controller.js";
import { CurrentMonthService } from "../modules/reporting/current-month.service.js";
import { registerCurrentMonthRoutes } from "../modules/reporting/current-month.controller.js";

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
      await fetch("http://127.0.0.1:8025/api/v1/send", {
        body: JSON.stringify({
          From: { Email: env.SES_FROM_ADDRESS, Name: "Cashmemo" },
          Subject: "Reset your Cashmemo password",
          Text: `Use this link to reset your password:\n\n${oneTimeUrl}\n\nThis link expires in 1 hour.`,
          To: [{ Email: destination, Name: "" }],
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
      await fetch("http://127.0.0.1:8025/api/v1/send", {
        body: JSON.stringify({
          From: { Email: env.SES_FROM_ADDRESS, Name: "Cashmemo" },
          Subject: "Verify your Cashmemo email address",
          Text: `Use this link to verify your email address:\n\n${oneTimeUrl}\n\nThis link expires in 24 hours.`,
          To: [{ Email: destination, Name: "" }],
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
  const privacy = new FinitePrivacyBoundary();
  const labels = new LabelsService({
    idempotencyHmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
    pool: runtimePool,
    privacy,
  });
  const cursorCodec = { hmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8") };
  const searchRepository = new SearchRepository({ cursorCodec, pool: runtimePool, privacy });
  const currentMonth = new CurrentMonthService({ pool: runtimePool });

  const app = Fastify({ logger: false });

  // Allow body parsing for DELETE requests (needed for revision checks)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      const json = JSON.parse(body as string) as unknown;
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // CORS — production uses APP_ORIGIN only; local dev also allows HTTP/HTTPS localhost
  const allowedOrigins =
    env.APP_ENV === "local"
      ? [env.APP_ORIGIN, "http://localhost:5173", "https://localhost:5173"]
      : [env.APP_ORIGIN];
  await app.register(import("@fastify/cors"), {
    credentials: true,
    origin: allowedOrigins,
  });

  registerLabelRoutes(app, { labels, sessions });
  registerHistorySearchRoute(app, {
    cursorCodec,
    pool: runtimePool,
    searchRepository,
    sessions,
    traversalOptions: { cursorCodec, pool: runtimePool },
  });
  registerCurrentMonthRoutes(app, { currentMonth, sessions });

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
    const preferences = await onboarding.setPreferences(ctx.accountId, {
      defaultCurrency: body.defaultCurrency,
      locale: body.locale,
      reportingTimezone: body.reportingTimezone,
    });
    await onboarding.seedStarterLabels(ctx.accountId);
    reply.code(200).send({
      accountStatus: "active",
      emailVerified: true,
      onboardingState: "complete",
      preferences: {
        defaultCurrency: preferences.defaultCurrency,
        locale: preferences.locale,
        reportingTimezone: preferences.reportingTimezone,
        revision: preferences.revision,
        timezoneBoundaryWarningRequired: false,
      },
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

  // ─── Money Memo endpoints ───

  app.post("/api/v1/memos", async (request, reply) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const ctx = await sessions.authenticate(headers);
      if (ctx === null) {
        reply.code(401).send();
        return;
      }
      const idempotencyKey = request.headers["x-idempotency-key"] as string;
      if (!idempotencyKey) {
        reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
        return;
      }
      const body = request.body as {
        confirmation: string;
        direction: "income" | "expense";
        money: { amount: string; currency: string };
        occurrence: {
          occurredAt: string;
          occurredLocal: string;
          occurredTimezone: string;
          occurredOffsetMinutes: number;
          timezoneDatabaseVersion: string;
        };
        categoryId: string | null;
        moneySpaceId: string | null;
        purpose: "personal" | "work" | "mixed" | null;
        planningStatus: "planned" | "unplanned" | null;
        note: string | null;
      };
      if (body.confirmation !== "CONFIRM_MONEY_MEMO") {
        reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
        return;
      }
      const requestHmac = canonicalRequestHmac({
        hmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
        operation: "memo_create",
        payload: body,
        schemaVersion: "memo-create-v1",
      });
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return createMoneyMemo(
          tx,
          {
            categoryId: body.categoryId,
            direction: body.direction,
            money: body.money,
            moneySpaceId: body.moneySpaceId,
            note: body.note,
            occurrence: body.occurrence,
            planningStatus: body.planningStatus,
            purpose: body.purpose,
          },
          idempotencyKey,
          Buffer.from(requestHmac, "hex"),
        );
      });
      reply.code(201).send(memo);
    } catch (error) {
      if (error instanceof MoneyValidationError) {
        reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      } else if (error instanceof MoneyMemoServiceError) {
        if (error.code === "OPERATION_IN_PROGRESS") {
          reply.code(409).send({ messageCode: "OPERATION_IN_PROGRESS" });
        } else {
          reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
        }
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  app.get("/api/v1/memos", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const query = request.query as { limit?: string; lifecycle?: string };
    const limit = Math.min(Number(query.limit ?? 50), 100);
    const lifecycle = query.lifecycle ?? "active";
    try {
      const result = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        const lifecycleFilter =
          lifecycle === "all_non_deleted" ? `IN ('active', 'archived')` : `= '${lifecycle}'`;
        const versionResult = await tx.query<{ version: string }>(
          `SELECT version::text FROM history_list_states WHERE user_id = $1`,
          [ctx.accountId],
        );
        const resultSetVersion = versionResult.rows[0]?.version ?? "1";
        const result = await tx.query(
          `SELECT * FROM money_memos WHERE user_id = $1 AND lifecycle_state ${lifecycleFilter}
           ORDER BY occurred_at DESC, id DESC LIMIT $2`,
          [ctx.accountId, limit + 1],
        );
        return {
          items: result.rows.slice(0, limit),
          resultSetVersion,
          nextCursor: result.rows.length > limit ? "more" : null,
        };
      });
      reply.code(200).send(result);
    } catch {
      reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
    }
  });

  app.get("/api/v1/memos/:memoId", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return getMoneyMemo(tx, memoId);
      });
      reply.code(200).send(memo);
    } catch (error) {
      if (error instanceof MoneyMemoServiceError && error.code === "MEMO_NOT_FOUND") {
        reply.code(404).send();
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  app.patch("/api/v1/memos/:memoId", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    const body = request.body as {
      expectedRevision: string;
      direction: "income" | "expense";
      money: { amount: string; currency: string };
      occurrence: {
        occurredAt: string;
        occurredLocal: string;
        occurredTimezone: string;
        occurredOffsetMinutes: number;
        timezoneDatabaseVersion: string;
      };
      categoryId: string | null;
      moneySpaceId: string | null;
      purpose: "personal" | "work" | "mixed" | null;
      planningStatus: "planned" | "unplanned" | null;
      note: string | null;
    };
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return updateMoneyMemo(
          tx,
          memoId,
          {
            categoryId: body.categoryId,
            direction: body.direction,
            money: body.money,
            moneySpaceId: body.moneySpaceId,
            note: body.note,
            occurrence: body.occurrence,
            planningStatus: body.planningStatus,
            purpose: body.purpose,
          },
          body.expectedRevision,
        );
      });
      reply.code(200).send(memo);
    } catch (error) {
      if (error instanceof MoneyMemoServiceError) {
        if (error.code === "REVISION_CONFLICT")
          reply.code(409).send({ messageCode: "REVISION_CONFLICT" });
        else if (error.code === "MEMO_NOT_FOUND") reply.code(404).send();
        else reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  app.post("/api/v1/memos/:memoId/archive", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    const body = request.body as { expectedRevision: string };
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return archiveMoneyMemo(tx, memoId, body.expectedRevision);
      });
      reply.code(200).send(memo);
    } catch (error) {
      if (error instanceof MoneyMemoServiceError && error.code === "REVISION_CONFLICT") {
        reply.code(409).send({ messageCode: "REVISION_CONFLICT" });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  app.delete("/api/v1/memos/:memoId/archive", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    const body = request.body as { expectedRevision: string };
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return restoreArchivedMoneyMemo(tx, memoId, body.expectedRevision);
      });
      reply.code(200).send(memo);
    } catch (error) {
      if (error instanceof MoneyMemoServiceError && error.code === "REVISION_CONFLICT") {
        reply.code(409).send({ messageCode: "REVISION_CONFLICT" });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  app.post("/api/v1/memos/:memoId/recently-deleted", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    const body = request.body as { expectedRevision: string };
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return moveToRecentlyDeleted(tx, memoId, body.expectedRevision);
      });
      reply.code(200).send(memo);
    } catch (error) {
      if (error instanceof MoneyMemoServiceError && error.code === "REVISION_CONFLICT") {
        reply.code(409).send({ messageCode: "REVISION_CONFLICT" });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  app.delete("/api/v1/memos/:memoId/recently-deleted", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    const body = request.body as { expectedRevision: string };
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return restoreRecentlyDeleted(tx, memoId, body.expectedRevision);
      });
      reply.code(200).send(memo);
    } catch (error) {
      if (error instanceof MoneyMemoServiceError && error.code === "REVISION_CONFLICT") {
        reply.code(409).send({ messageCode: "REVISION_CONFLICT" });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  app.post("/api/v1/memos/:memoId/purge", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    const body = request.body as { expectedRevision: string };
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return initiatePurge(tx, memoId, body.expectedRevision);
      });
      reply.code(200).send(memo);
    } catch (error) {
      if (error instanceof MoneyMemoServiceError && error.code === "REVISION_CONFLICT") {
        reply.code(409).send({ messageCode: "REVISION_CONFLICT" });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
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
