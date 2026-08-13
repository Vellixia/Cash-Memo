import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { secureDownloadHeaders } from "../../adapters/http/security-boundary.js";
import type { SessionService } from "../identity/session.service.js";
import { ExportJobServiceError, type ExportJobService } from "./export-job.service.js";

interface ExportControllerOptions {
  readonly exports: ExportJobService;
  readonly sessions: Pick<SessionService, "authenticate" | "consumeReauthGrant">;
  readonly workerId?: string;
}

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return headers;
}

function noStore(reply: FastifyReply): void {
  void reply.headers({ "Cache-Control": "private, no-store", Pragma: "no-cache", Vary: "Cookie" });
}

function productError(code: string, retryable = false) {
  return Object.freeze({
    code,
    correlationId: randomUUID(),
    fieldErrors: [],
    messageCode: code,
    retryAfterSeconds: null,
    retryable,
  });
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: ExportControllerOptions["sessions"],
) {
  const session = await sessions.authenticate(requestHeaders(request));
  if (session !== null) return session;
  await reply.code(401).send(productError("UNAUTHENTICATED"));
  return null;
}

async function requireRecentAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: ExportControllerOptions["sessions"],
  session: { readonly accountId: string; readonly sessionId: string },
): Promise<boolean> {
  const grant = request.headers["x-reauth-grant"];
  if (
    typeof grant !== "string" ||
    !(await sessions.consumeReauthGrant(grant, session.accountId, session.sessionId, "export"))
  ) {
    await reply.code(401).send(productError("REAUTH_REQUIRED"));
    return false;
  }
  return true;
}

function sendExportError(reply: FastifyReply, error: unknown): void {
  if (!(error instanceof ExportJobServiceError)) {
    void reply.code(503).send(productError("EXPORT_UNAVAILABLE", true));
    return;
  }
  switch (error.code) {
    case "EXPORT_NOT_FOUND":
      void reply.code(404).send(productError("NOT_FOUND"));
      return;
    case "EXPORT_NOT_READY":
      void reply.code(409).send(productError("EXPORT_NOT_READY", true));
      return;
    case "VALIDATION_ERROR":
      void reply.code(400).send(productError("VALIDATION_FAILED"));
      return;
    case "IDEMPOTENCY_CONFLICT":
    case "OPERATION_IN_PROGRESS":
    case "REVISION_CONFLICT":
    case "STATE_CONFLICT":
      void reply.code(409).send(productError(error.code));
  }
}

function registerExportRoutes(
  app: FastifyInstance,
  options: Readonly<ExportControllerOptions>,
): void {
  const workerId = options.workerId ?? randomUUID();

  app.post("/api/v1/exports", async (request, reply) => {
    noStore(reply);
    const session = await authenticate(request, reply, options.sessions);
    if (session === null || !(await requireRecentAuth(request, reply, options.sessions, session))) {
      return;
    }
    const body = request.body as {
      includeRecoverableDrafts?: boolean;
      schemaVersion?: string;
    };
    const key = request.headers["idempotency-key"];
    try {
      if (
        typeof key !== "string" ||
        typeof body.includeRecoverableDrafts !== "boolean" ||
        body.schemaVersion !== "1.0"
      ) {
        throw new ExportJobServiceError("VALIDATION_ERROR");
      }
      const includeRecoverableDrafts = body.includeRecoverableDrafts;
      const job = await options.exports.request(session.accountId, {
        idempotencyKey: key,
        includeRecoverableDrafts,
        schemaVersion: "1.0",
      });
      await reply.code(202).send(job);
      queueMicrotask(() => {
        void options.exports
          .process(session.accountId, job.id, includeRecoverableDrafts, workerId)
          .catch(() => undefined);
      });
    } catch (error) {
      sendExportError(reply, error);
    }
  });

  app.get("/api/v1/exports", async (request, reply) => {
    noStore(reply);
    const session = await authenticate(request, reply, options.sessions);
    if (session === null) return;
    try {
      await reply.code(200).send(await options.exports.list(session.accountId));
    } catch (error) {
      sendExportError(reply, error);
    }
  });

  app.get("/api/v1/exports/:exportId", async (request, reply) => {
    noStore(reply);
    const session = await authenticate(request, reply, options.sessions);
    if (session === null) return;
    try {
      const exportId = (request.params as { exportId: string }).exportId;
      await reply.code(200).send(await options.exports.get(session.accountId, exportId));
    } catch (error) {
      sendExportError(reply, error);
    }
  });

  app.post("/api/v1/exports/:exportId/download", async (request, reply) => {
    noStore(reply);
    const session = await authenticate(request, reply, options.sessions);
    if (session === null || !(await requireRecentAuth(request, reply, options.sessions, session))) {
      return;
    }
    try {
      const exportId = (request.params as { exportId: string }).exportId;
      const stream = await options.exports.download(session.accountId, exportId);
      await reply.headers(secureDownloadHeaders("cashmemo-export.zip")).code(200).send(stream);
    } catch (error) {
      sendExportError(reply, error);
    }
  });

  app.delete("/api/v1/exports/:exportId", async (request, reply) => {
    noStore(reply);
    const session = await authenticate(request, reply, options.sessions);
    if (session === null || !(await requireRecentAuth(request, reply, options.sessions, session))) {
      return;
    }
    const body = request.body as { expectedRevision?: string };
    try {
      if (typeof body.expectedRevision !== "string") {
        throw new ExportJobServiceError("VALIDATION_ERROR");
      }
      const exportId = (request.params as { exportId: string }).exportId;
      await reply
        .code(202)
        .send(await options.exports.cancel(session.accountId, exportId, body.expectedRevision));
    } catch (error) {
      sendExportError(reply, error);
    }
  });
}

export { registerExportRoutes, type ExportControllerOptions };
