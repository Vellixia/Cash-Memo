import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import { Pool } from "pg";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import { canonicalRequestHmac } from "@cashmemo/domain";

import { parseEnvironment } from "./environment.schema.js";
import { resolveCapabilityMode } from "./capability-mode.js";
import { OtlpHttpTelemetrySink } from "../adapters/telemetry/otlp-http.sink.js";
import { ResilientTelemetryExporter } from "../adapters/telemetry/resilient-exporter.js";
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
import { MonthlyReviewService } from "../modules/reporting/monthly-review.service.js";
import { registerMonthlyReviewRoutes } from "../modules/reporting/monthly-review.controller.js";
import {
  ContractScenarioExtractionAdapter,
  ContractScenarioSttAdapter,
  DeterministicExtractionAdapter,
  DeterministicSttAdapter,
} from "../adapters/fakes/assisted-provider.adapters.js";
import { TextExtractionService } from "../modules/assisted-capture/text-extraction.service.js";
import { TranscriptService } from "../modules/assisted-capture/transcript.service.js";
import {
  MemoryEphemeralAudioStore,
  TemporaryAudioService,
  type AudioInspection,
} from "../modules/assisted-capture/temporary-audio.service.js";
import { VoiceCaptureService } from "../modules/assisted-capture/voice-capture.service.js";
import { registerAssistedCaptureRoutes } from "../modules/assisted-capture/voice-capture.controller.js";
import { ConfirmDraftService } from "../modules/assisted-capture/confirm-draft.service.js";
import { AudioSweeper } from "../modules/operations/audio-sweeper.js";
import { BackgroundJobRepository } from "../modules/operations/background-jobs.js";
import {
  ContractExportObjectStore,
  RustfsExportObjectStoreAdapter,
  type ExportObjectStore,
} from "../adapters/rustfs/export-object-store.adapter.js";
import {
  RustfsMinioDeletionLedgerClient,
  RustfsMinioExportClient,
} from "../adapters/rustfs/minio-s3-compatible.client.js";
import { RustfsDeletionSuppressionAdapter } from "../adapters/rustfs/deletion-suppression.adapter.js";
import {
  allowedOrigins,
  privateSecurityHeaders,
  requireSameOrigin,
} from "../adapters/http/security-boundary.js";
import { ExportJobService } from "../modules/export/export-job.service.js";
import { registerExportRoutes } from "../modules/export/export.controller.js";
import {
  ContractDeletionSuppressionPort,
  type DeletionSuppressionPort,
} from "../modules/deletion/deletion-suppression.port.js";
import { MemoPurgeWorker } from "../modules/deletion/memo-purge.worker.js";
import { AccountPurgeWorker } from "../modules/deletion/account-purge.worker.js";
import { AccountDeletionService } from "../modules/deletion/account-deletion.service.js";
import { registerAccountDeletionRoutes } from "../modules/deletion/account-deletion.controller.js";
import { ProviderDeletionService } from "../modules/deletion/provider-deletion.service.js";
import { PrivacyBoundaryService } from "../modules/privacy/privacy-boundary.service.js";
import { AbuseControls, abuseOperationForRequest } from "../modules/operations/abuse-controls.js";
import { createMailpitAdapter } from "../adapters/mailpit/mailpit-email.adapter.js";
import { createCloudflareEmailAdapter } from "../adapters/cloudflare/cloudflare-email.adapter.js";
import type { EmailPort } from "../modules/identity/email.port.js";

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

  const workerPool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    options: "-c role=cashmemo_worker",
  });

  // Idle client failures during a database outage are handled at request boundaries.
  // Register content-free listeners so pg does not turn an expected outage into a process crash.
  identityPool.on("error", () => undefined);
  runtimePool.on("error", () => undefined);
  workerPool.on("error", () => undefined);

  const email: EmailPort =
    env.EMAIL_PROVIDER === "mailpit"
      ? createMailpitAdapter({
          apiUrl: env.MAILPIT_API_URL ?? "",
          fromAddress: env.EMAIL_FROM_ADDRESS,
        })
      : env.EMAIL_PROVIDER === "cloudflare"
        ? createCloudflareEmailAdapter({
            accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
            apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN ?? "",
            baseUrl: env.CLOUDFLARE_EMAIL_BASE_URL,
            fromAddress: env.EMAIL_FROM_ADDRESS,
          })
        : {
            send: () => Promise.reject(new Error("EMAIL_DELIVERY_DISABLED")),
          };

  const deliver = async (
    operation: "password_reset" | "verification",
    destination: string,
    oneTimeUrl: string,
  ) => {
    const result = await email.send({ destination, oneTimeUrl, operation });
    if (result.state === "failed" || result.state === "bounced") {
      throw new Error("EMAIL_DELIVERY_UNAVAILABLE");
    }
  };

  const deliveryCallbacks = {
    sendPasswordReset: async ({
      destination,
      oneTimeUrl,
    }: {
      destination: string;
      oneTimeUrl: string;
    }) => {
      await deliver("password_reset", destination, oneTimeUrl);
    },
    sendVerification: async ({
      destination,
      oneTimeUrl,
    }: {
      destination: string;
      oneTimeUrl: string;
    }) => {
      await deliver("verification", destination, oneTimeUrl);
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
  const privacy = new PrivacyBoundaryService();
  const abuseControls = new AbuseControls(Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"));
  const labels = new LabelsService({
    idempotencyHmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
    pool: runtimePool,
    privacy,
  });
  const cursorCodec = { hmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8") };
  const searchRepository = new SearchRepository({ cursorCodec, pool: runtimePool, privacy });
  const currentMonth = new CurrentMonthService({ pool: runtimePool });
  const monthlyReview = new MonthlyReviewService({ pool: runtimePool });
  let contractObjectStore: ContractExportObjectStore | undefined;
  let objectStore: ExportObjectStore;
  if (env.OBJECT_STORAGE_MODE === "rustfs") {
    objectStore = new RustfsExportObjectStoreAdapter({
      bucket: env.RUSTFS_EXPORT_BUCKET ?? "",
      client: new RustfsMinioExportClient({
        accessKey: env.RUSTFS_PRIMARY_ACCESS_KEY ?? "",
        endpoint: env.RUSTFS_PRIMARY_ENDPOINT ?? "",
        region: env.RUSTFS_PRIMARY_REGION ?? "",
        secretKey: env.RUSTFS_PRIMARY_SECRET_KEY ?? "",
      }),
    });
  } else {
    const contractStore = new ContractExportObjectStore();
    if (env.OBJECT_STORAGE_MODE === "disabled") contractStore.setWriteFailureForTest(true);
    contractObjectStore = contractStore;
    objectStore = contractStore;
  }
  const backgroundJobs = new BackgroundJobRepository(workerPool, {
    backoffBaseMilliseconds: 1_000,
    backoffMaximumMilliseconds: 60_000,
    leaseMilliseconds: 30_000,
  });
  const exports = new ExportJobService({
    backgroundJobs,
    hmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
    objectReferenceKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
    objectStore,
    pool: runtimePool,
  });
  let contractSuppression: ContractDeletionSuppressionPort | undefined;
  let suppression: DeletionSuppressionPort;
  if (env.BACKUP_MODE === "pgbackrest") {
    suppression = new RustfsDeletionSuppressionAdapter({
      bucket: env.RUSTFS_SECONDARY_BUCKET ?? "",
      client: new RustfsMinioDeletionLedgerClient({
        accessKey: env.RUSTFS_SECONDARY_ACCESS_KEY ?? "",
        encryptedStoragePolicyVerified:
          env.RUSTFS_SECONDARY_STORAGE_POLICY_VERSION === "cashmemo-rustfs-encrypted-v1",
        endpoint: env.RUSTFS_SECONDARY_ENDPOINT ?? "",
        region: env.RUSTFS_SECONDARY_REGION ?? "",
        secretKey: env.RUSTFS_SECONDARY_SECRET_KEY ?? "",
      }),
      ...(env.DELETION_LEDGER_NAMESPACE === undefined
        ? {}
        : { namespace: env.DELETION_LEDGER_NAMESPACE }),
    });
  } else {
    contractSuppression = new ContractDeletionSuppressionPort();
    suppression = contractSuppression;
  }
  const deletionWorkerOptions = {
    auditHmacKey: Buffer.from(env.EVIDENCE_HMAC_KEY, "utf8"),
    policyVersion: "phase12-v1",
    pool: runtimePool,
    suppressionKey: Buffer.from(env.DELETION_SUPPRESSION_HMAC_KEY, "utf8"),
    suppressionKeyVersion: "v1",
    suppressionPort: suppression,
  } as const;
  const memoPurgeWorker = new MemoPurgeWorker(deletionWorkerOptions);
  const accountPurgeWorker = new AccountPurgeWorker({
    ...deletionWorkerOptions,
    deleteExports: (accountId) => exports.deleteAllForAccount(accountId),
    identityPool,
  });
  const accountDeletion = new AccountDeletionService({
    cancelExports: (accountId) => exports.deleteAllForAccount(accountId),
    hmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
    pool: runtimePool,
  });
  const providerDeletion = new ProviderDeletionService({ pool: runtimePool });
  const capabilityMode = resolveCapabilityMode({
    assistedCaptureMode: env.ASSISTED_CAPTURE_MODE,
    providerConfigurationValid: env.ASSISTED_CAPTURE_MODE !== "openai",
    telemetryConfigured: env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
  });
  let assisted:
    | {
        readonly confirmation: ConfirmDraftService;
        readonly text: TextExtractionService;
        readonly voice: VoiceCaptureService;
      }
    | undefined;
  let closeAssisted = (): Promise<void> => Promise.resolve();

  if (capabilityMode.shouldInitializeProviders) {
    const fakeMode = env.ASSISTED_CAPTURE_MODE === "fake";
    // Contract fakes are explicit test mode only. Production never silently falls back to them.
    const extraction = fakeMode
      ? new ContractScenarioExtractionAdapter()
      : new DeterministicExtractionAdapter({ mode: "failure" });
    const stt = fakeMode
      ? new ContractScenarioSttAdapter()
      : new DeterministicSttAdapter({ mode: "failure" });
    const text = new TextExtractionService({ extraction, pool: runtimePool, privacy });
    const transcript = new TranscriptService({ extraction, pool: runtimePool, privacy });
    const audio = new TemporaryAudioService({
      inspector: {
        inspect: (_bytes, declaredMediaType): Promise<AudioInspection> =>
          Promise.resolve({
            codec:
              declaredMediaType === "audio/wav"
                ? "pcm"
                : declaredMediaType === "audio/mpeg"
                  ? "mp3"
                  : declaredMediaType === "audio/mp4"
                    ? "aac"
                    : "opus",
            detectedMediaType: declaredMediaType,
            measuredDurationMs: 1_000,
          }),
      },
      ownerHmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
      pool: runtimePool,
      store: new MemoryEphemeralAudioStore(),
    });
    const voice = new VoiceCaptureService({ audio, pool: runtimePool, stt, transcript });
    const audioSweeper = new AudioSweeper({ audio });
    await audioSweeper.startupCleanup();
    audioSweeper.start();
    const removeAudioTerminationHooks = audioSweeper.installTerminationHook();
    closeAssisted = async () => {
      removeAudioTerminationHooks();
      await audioSweeper.terminate();
    };
    assisted = {
      confirmation: new ConfirmDraftService({
        hmacKey: Buffer.from(env.AUTH_TOKEN_HMAC_KEY, "utf8"),
        pool: runtimePool,
        privacy,
      }),
      text,
      voice,
    };
  }

  const app = Fastify({ logger: false });
  const telemetry =
    env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
      ? undefined
      : new ResilientTelemetryExporter({
          batchSize: 32,
          maxLatencyMs: 5_000,
          maxQueueSize: 1_024,
          sink: new OtlpHttpTelemetrySink(env.OTEL_EXPORTER_OTLP_ENDPOINT),
        });
  app.addHook("onResponse", (_request, reply, done) => {
    telemetry?.record({
      count: 1,
      name: reply.statusCode >= 500 ? "operation_failed" : "operation_completed",
    });
    done();
  });
  app.addHook("onClose", async () => {
    await telemetry?.flush();
  });
  app.addHook("onClose", async () => {
    await closeAssisted();
    await workerPool.end();
    await runtimePool.end();
    await identityPool.end();
  });

  for (const mediaType of ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"]) {
    app.addContentTypeParser(
      mediaType,
      { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 },
      (_request, body, done) => {
        done(null, body);
      },
    );
  }

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
  const securityEnvironment = { appOrigin: env.APP_ORIGIN, environment: env.APP_ENV } as const;
  const configuredOrigins = allowedOrigins(securityEnvironment);
  await app.register(import("@fastify/cors"), {
    credentials: true,
    origin: [...configuredOrigins],
  });

  app.addHook("onRequest", async (request, reply) => {
    const originRequired = !new Set(["local", "test"]).has(env.APP_ENV);
    if (
      (originRequired || request.headers.origin !== undefined) &&
      requireSameOrigin({
        configuration: securityEnvironment,
        method: request.method,
        origin: request.headers.origin,
      }) === "blocked"
    ) {
      await reply.code(403).send({ messageCode: "ORIGIN_NOT_ALLOWED" });
    }
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(
      privateSecurityHeaders(env.APP_ORIGIN.startsWith("https://")),
    )) {
      if (!reply.hasHeader(name)) void reply.header(name, value);
    }
    return payload;
  });
  app.addHook("preHandler", async (request, reply) => {
    const operation = abuseOperationForRequest(request.method, request.url);
    if (operation === null) return;
    const opaquePrincipal = request.headers.cookie ?? request.ip;
    const decision = abuseControls.check(operation, opaquePrincipal);
    if (!decision.allowed) {
      if (decision.retryAfterSeconds !== null) {
        void reply.header("Retry-After", String(decision.retryAfterSeconds));
      }
      await reply.code(429).send({ messageCode: decision.code });
    }
  });

  const suspendedJournalPrefixes = [
    "/api/v1/categories",
    "/api/v1/drafts",
    "/api/v1/exports",
    "/api/v1/history",
    "/api/v1/memos",
    "/api/v1/money-spaces",
    "/api/v1/overview",
    "/api/v1/reviews",
    "/api/v1/voice-captures",
  ];
  app.addHook("preHandler", async (request, reply) => {
    if (!suspendedJournalPrefixes.some((prefix) => request.url.startsWith(prefix))) return;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const session = await sessions.authenticate(headers);
    if (
      session !== null &&
      (await accountDeletion.journalAccessState(session.accountId)) === "suspended"
    ) {
      await reply
        .headers({ "Cache-Control": "private, no-store", Vary: "Cookie" })
        .code(409)
        .send({ messageCode: "ACCOUNT_DELETION_GRACE" });
    }
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
  registerMonthlyReviewRoutes(app, { monthlyReview, sessions });
  registerExportRoutes(app, { exports, sessions });
  registerAccountDeletionRoutes(app, { deletions: accountDeletion, sessions });
  if (env.APP_ENV === "local") {
    app.post("/api/v1/test-support/deletion-faults", async (request, reply) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      if ((await sessions.authenticate(headers)) === null) {
        await reply.code(401).send({ messageCode: "UNAUTHENTICATED" });
        return;
      }
      const body = request.body as {
        exportWriteFailure?: boolean;
        suppressionWriteFailure?: boolean;
      };
      contractSuppression?.setWriteFailureForTest(body.suppressionWriteFailure === true);
      contractObjectStore?.setWriteFailureForTest(body.exportWriteFailure === true);
      await reply.code(204).send();
    });

    app.post("/api/v1/test-support/exports/expire", async (request, reply) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const session = await sessions.authenticate(headers);
      if (session === null) {
        await reply.code(401).send({ messageCode: "UNAUTHENTICATED" });
        return;
      }
      const body = request.body as { now?: string };
      const now = typeof body.now === "string" ? new Date(body.now) : new Date();
      if (Number.isNaN(now.getTime())) {
        await reply.code(400).send({ messageCode: "VALIDATION_FAILED" });
        return;
      }
      await reply.code(200).send({ expired: await exports.expireDue(session.accountId, now) });
    });

    app.post("/api/v1/test-support/exports/:exportId/retry", async (request, reply) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const session = await sessions.authenticate(headers);
      if (session === null) {
        await reply.code(401).send({ messageCode: "UNAUTHENTICATED" });
        return;
      }
      const exportId = (request.params as { exportId: string }).exportId;
      const body = request.body as { includeRecoverableDrafts?: boolean };
      try {
        await reply
          .code(200)
          .send(
            await exports.process(
              session.accountId,
              exportId,
              body.includeRecoverableDrafts === true,
              crypto.randomUUID(),
            ),
          );
      } catch {
        await reply.code(503).send({ messageCode: "EXPORT_UNAVAILABLE" });
      }
    });

    app.post("/api/v1/test-support/memos/:memoId/purge-retry", async (request, reply) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const session = await sessions.authenticate(headers);
      if (session === null) {
        await reply.code(401).send({ messageCode: "UNAUTHENTICATED" });
        return;
      }
      const memoId = (request.params as { memoId: string }).memoId;
      await reply.code(200).send(await memoPurgeWorker.purge(session.accountId, memoId));
    });

    app.post("/api/v1/test-support/account-deletion/advance", async (request, reply) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      const session = await sessions.authenticate(headers);
      if (session === null) {
        await reply.code(401).send({ messageCode: "UNAUTHENTICATED" });
        return;
      }
      const body = request.body as { now?: string; providerFailure?: boolean };
      const now = typeof body.now === "string" ? new Date(body.now) : new Date();
      if (Number.isNaN(now.getTime())) {
        await reply.code(400).send({ messageCode: "VALIDATION_FAILED" });
        return;
      }
      let irreversible = await accountDeletion.status(session.accountId);
      if (irreversible.state === "grace") {
        irreversible = await accountDeletion.beginIrreversible(session.accountId, now);
      } else if (irreversible.state === "failed") {
        irreversible = await accountDeletion.retryFailed(session.accountId);
      }
      if (irreversible.state !== "purging") {
        await reply.code(409).send({ messageCode: "STATE_CONFLICT" });
        return;
      }
      await providerDeletion.initialize(session.accountId, irreversible.id, {
        ai: { decisionVersion: env.PROVIDER_DECISION_VERSION, required: false },
        email: {
          decisionVersion: env.PROVIDER_DECISION_VERSION,
          required: body.providerFailure === true,
        },
        storage: { decisionVersion: env.PROVIDER_DECISION_VERSION, required: false },
        stt: { decisionVersion: env.PROVIDER_DECISION_VERSION, required: false },
      });
      const purge = await accountPurgeWorker.purge(session.accountId, irreversible.id);
      if (purge.state === "live_purged") {
        if (body.providerFailure === true) {
          await providerDeletion.markFailed(session.accountId, irreversible.id, "email", true);
        }
        await providerDeletion.reconcileAccountState(session.accountId, irreversible.id);
      }
      await reply.code(200).send({
        deletion: await accountDeletion.status(session.accountId),
        purge,
      });
    });
  }
  if (assisted !== undefined) {
    registerAssistedCaptureRoutes(app, {
      confirmation: assisted.confirmation,
      pool: runtimePool,
      sessions,
      text: assisted.text,
      voice: assisted.voice,
    });
  }

  app.get("/api/v1/capabilities", async (_request, reply) => {
    reply.header("Cache-Control", "no-store").code(200).send(capabilityMode);
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

  app.post("/api/v1/auth/reauth", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const session = await sessions.authenticate(headers);
    const body = request.body as { password?: string; scope?: string[] };
    const allowed = new Set(["account_delete", "export", "purge"]);
    if (
      session === null ||
      typeof body.password !== "string" ||
      !Array.isArray(body.scope) ||
      body.scope.length === 0 ||
      body.scope.some((scope) => !allowed.has(scope)) ||
      !(await identity.verifyPasswordForAccount(session.accountId, body.password))
    ) {
      await reply
        .headers({ "Cache-Control": "private, no-store", Vary: "Cookie" })
        .code(401)
        .send({ messageCode: "REAUTH_REQUIRED" });
      return;
    }
    const grant = await sessions.createReauthGrant(
      session.accountId,
      session.sessionId,
      body.scope,
    );
    await reply.headers({ "Cache-Control": "private, no-store", Vary: "Cookie" }).code(200).send({
      expiresAt: grant.expiresAt.toISOString(),
      grantId: grant.grantId,
      scope: grant.scope,
    });
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
      const privacyDecision = await privacy.evaluateText({
        boundary: "memo_note_persistence",
        content: body.note ?? "",
        ruleSetVersion: "privacy-detector-v1",
      });
      if (privacyDecision.decision !== "allow") {
        reply.code(422).send({ messageCode: "PRIVACY_BOUNDARY_BLOCKED" });
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
      const privacyDecision = await privacy.evaluateText({
        boundary: "memo_note_persistence",
        content: body.note ?? "",
        ruleSetVersion: "privacy-detector-v1",
      });
      if (privacyDecision.decision !== "allow") {
        reply.code(422).send({ messageCode: "PRIVACY_BOUNDARY_BLOCKED" });
        return;
      }
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
    const grant = request.headers["x-reauth-grant"];
    if (
      typeof grant !== "string" ||
      !(await sessions.consumeReauthGrant(grant, ctx.accountId, ctx.sessionId, "purge"))
    ) {
      reply.code(401).send({ messageCode: "REAUTH_REQUIRED" });
      return;
    }
    const memoId = (request.params as { memoId: string }).memoId;
    const body = request.body as { expectedRevision: string };
    try {
      const memo = await withAccountTransaction(runtimePool, ctx.accountId, async (tx) => {
        return initiatePurge(tx, memoId, body.expectedRevision);
      });
      reply.code(200).send(memo);
      queueMicrotask(() => {
        void memoPurgeWorker.purge(ctx.accountId, memoId).catch(() => undefined);
      });
    } catch (error) {
      if (error instanceof MoneyMemoServiceError && error.code === "REVISION_CONFLICT") {
        reply.code(409).send({ messageCode: "REVISION_CONFLICT" });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });

  // Content-free process liveness and authoritative dependency readiness.
  app.get("/api/v1/live", () => ({ role: "api", status: "ok" }));
  const readiness = async (_request: unknown, reply: FastifyReply) => {
    try {
      await runtimePool.query("SELECT 1");
      return { role: "api", status: "ok" };
    } catch {
      return reply.code(503).send({ role: "api", status: "unavailable" });
    }
  };
  app.get("/api/v1/ready", readiness);
  app.get("/api/v1/health", readiness);

  if (process.env["NODE_ENV"] === "production") {
    const webRoot = resolve(process.cwd(), "apps/web/dist");
    const contentTypes: Readonly<Record<string, string>> = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webmanifest": "application/manifest+json",
    };
    const servePwa = async (request: FastifyRequest, reply: FastifyReply) => {
      const requested = ((request.params as { "*"?: string })["*"] ?? "").replace(/^\/+/, "");
      if (requested.startsWith("api/")) {
        return reply.code(404).send({ messageCode: "NOT_FOUND" });
      }
      const assetPath = requested !== "" && extname(requested) !== "" ? requested : "index.html";
      const target = resolve(webRoot, assetPath);
      if (target !== webRoot && !target.startsWith(`${webRoot}${sep}`)) {
        return reply.code(404).send({ messageCode: "NOT_FOUND" });
      }
      try {
        const body = await readFile(target);
        void reply.type(contentTypes[extname(target)] ?? "application/octet-stream");
        void reply.header(
          "Cache-Control",
          target.endsWith("index.html")
            ? "public, no-cache"
            : "public, max-age=31536000, immutable",
        );
        return await reply.send(body);
      } catch {
        return reply.code(404).send({ messageCode: "NOT_FOUND" });
      }
    };
    app.get("/", servePwa);
    app.get("/*", servePwa);
  }

  await app.listen({ host: "0.0.0.0", port });
  console.log(`Server listening on port ${String(port)}`);
}

void main().catch(() => {
  console.error("SERVER_STARTUP_FAILED");
  process.exitCode = 1;
});
