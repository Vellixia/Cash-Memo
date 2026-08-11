import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { SessionService } from "../identity/session.service.js";
import {
  AccountDeletionServiceError,
  type AccountDeletionService,
} from "./account-deletion.service.js";

interface AccountDeletionControllerOptions {
  readonly deletions: AccountDeletionService;
  readonly sessions: Pick<SessionService, "authenticate" | "consumeReauthGrant">;
}

function headers(request: FastifyRequest): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) result.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  return result;
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

function privateNoStore(reply: FastifyReply): void {
  void reply.headers({ "Cache-Control": "private, no-store", Pragma: "no-cache", Vary: "Cookie" });
}

function sendError(reply: FastifyReply, error: unknown): void {
  if (!(error instanceof AccountDeletionServiceError)) {
    void reply.code(503).send(productError("ACCOUNT_DELETION_UNAVAILABLE", true));
    return;
  }
  if (error.code === "ACCOUNT_DELETION_NOT_FOUND") {
    void reply.code(404).send(productError("NOT_FOUND"));
  } else if (error.code === "VALIDATION_ERROR") {
    void reply.code(400).send(productError("VALIDATION_FAILED"));
  } else {
    void reply.code(409).send(productError(error.code));
  }
}

function registerAccountDeletionRoutes(
  app: FastifyInstance,
  options: Readonly<AccountDeletionControllerOptions>,
): void {
  app.post("/api/v1/me/account-deletion", async (request, reply) => {
    privateNoStore(reply);
    const session = await options.sessions.authenticate(headers(request));
    if (session === null) {
      await reply.code(401).send(productError("UNAUTHENTICATED"));
      return;
    }
    const grant = request.headers["x-reauth-grant"];
    if (
      typeof grant !== "string" ||
      !(await options.sessions.consumeReauthGrant(
        grant,
        session.accountId,
        session.sessionId,
        "account_delete",
      ))
    ) {
      await reply.code(401).send(productError("REAUTH_REQUIRED"));
      return;
    }
    const body = request.body as { confirmation?: string };
    const key = request.headers["idempotency-key"];
    if (body.confirmation !== "DELETE_MY_CASHMEMO_ACCOUNT" || typeof key !== "string") {
      await reply.code(400).send(productError("VALIDATION_FAILED"));
      return;
    }
    try {
      await reply.code(202).send(await options.deletions.request(session.accountId, key));
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/v1/me/account-deletion", async (request, reply) => {
    privateNoStore(reply);
    const session = await options.sessions.authenticate(headers(request));
    if (session === null) {
      await reply.code(401).send(productError("UNAUTHENTICATED"));
      return;
    }
    try {
      await reply.code(200).send(await options.deletions.status(session.accountId));
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete("/api/v1/me/account-deletion", async (request, reply) => {
    privateNoStore(reply);
    const session = await options.sessions.authenticate(headers(request));
    if (session === null) {
      await reply.code(401).send(productError("UNAUTHENTICATED"));
      return;
    }
    const body = request.body as { expectedRevision?: string };
    if (typeof body.expectedRevision !== "string") {
      await reply.code(400).send(productError("VALIDATION_FAILED"));
      return;
    }
    try {
      await options.deletions.cancel(session.accountId, body.expectedRevision);
      await reply.code(204).send();
    } catch (error) {
      sendError(reply, error);
    }
  });
}

export { registerAccountDeletionRoutes, type AccountDeletionControllerOptions };
