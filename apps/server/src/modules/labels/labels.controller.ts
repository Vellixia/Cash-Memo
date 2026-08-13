import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { SessionAuthenticationPort } from "../identity/application/ports/session-authentication.port.js";
import {
  LabelServiceError,
  type CategoryKind,
  type LabelErrorCode,
  type LabelListStatus,
  type LabelStatus,
  type LabelsService,
} from "./labels.service.js";

export interface LabelControllerOptions {
  readonly labels: LabelsService;
  readonly sessions: SessionAuthenticationPort;
}

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return headers;
}

async function accountId(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: SessionAuthenticationPort,
): Promise<string | null> {
  const context = await sessions.authenticate(requestHeaders(request));
  if (context !== null) return context.accountId;
  await reply.code(401).send({ messageCode: "UNAUTHENTICATED" });
  return null;
}

function sendLabelError(reply: FastifyReply, error: unknown): void {
  if (!(error instanceof LabelServiceError)) {
    void reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
    return;
  }
  const status = statusForLabelError(error.code);
  void reply.code(status).send({ messageCode: error.code });
}

function statusForLabelError(code: LabelErrorCode): 400 | 404 | 409 | 422 {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "LABEL_NOT_FOUND":
      return 404;
    case "PRIVACY_BOUNDARY_BLOCKED":
      return 422;
    case "IDEMPOTENCY_CONFLICT":
    case "INVALID_STATE_TRANSITION":
    case "LABEL_CONFLICT":
    case "LABEL_KIND_MISMATCH":
    case "OPERATION_IN_PROGRESS":
    case "REVISION_CONFLICT":
      return 409;
  }
}

function idempotencyKey(request: FastifyRequest): string | null {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" ? value : null;
}

export function registerLabelRoutes(
  app: FastifyInstance,
  options: Readonly<LabelControllerOptions>,
): void {
  app.get("/api/v1/categories", async (request, reply) => {
    const owner = await accountId(request, reply, options.sessions);
    if (owner === null) return;
    const query = request.query as { kind?: CategoryKind; status?: LabelListStatus };
    try {
      const result = await options.labels.listCategories(owner, {
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        status: query.status ?? "all",
      });
      await reply.code(200).send(result);
    } catch (error) {
      sendLabelError(reply, error);
    }
  });

  app.post("/api/v1/categories", async (request, reply) => {
    const owner = await accountId(request, reply, options.sessions);
    if (owner === null) return;
    const key = idempotencyKey(request);
    if (key === null) {
      await reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      return;
    }
    const body = request.body as { kind?: CategoryKind; name?: string };
    try {
      if ((body.kind !== "income" && body.kind !== "expense") || typeof body.name !== "string") {
        throw new LabelServiceError("VALIDATION_ERROR");
      }
      const result = await options.labels.createCategory(owner, {
        idempotencyKey: key,
        kind: body.kind,
        name: body.name,
      });
      await reply.code(201).send(result);
    } catch (error) {
      sendLabelError(reply, error);
    }
  });

  app.patch("/api/v1/categories/:categoryId", async (request, reply) => {
    const owner = await accountId(request, reply, options.sessions);
    if (owner === null) return;
    const id = (request.params as { categoryId: string }).categoryId;
    const body = request.body as {
      expectedRevision?: string;
      name?: string;
      status?: LabelStatus;
    };
    try {
      if (body.expectedRevision === undefined) throw new LabelServiceError("VALIDATION_ERROR");
      if (body.name !== undefined && body.status === undefined) {
        await reply.code(200).send(
          await options.labels.renameCategory(owner, id, {
            expectedRevision: body.expectedRevision,
            name: body.name,
          }),
        );
        return;
      }
      if (body.status === "inactive" && body.name === undefined) {
        await reply
          .code(200)
          .send(await options.labels.deactivateCategory(owner, id, body.expectedRevision));
        return;
      }
      if (body.status === "active" && body.name === undefined) {
        await reply
          .code(200)
          .send(await options.labels.restoreCategory(owner, id, body.expectedRevision));
        return;
      }
      throw new LabelServiceError("VALIDATION_ERROR");
    } catch (error) {
      sendLabelError(reply, error);
    }
  });

  app.get("/api/v1/money-spaces", async (request, reply) => {
    const owner = await accountId(request, reply, options.sessions);
    if (owner === null) return;
    const query = request.query as { status?: LabelListStatus };
    try {
      await reply
        .code(200)
        .send(await options.labels.listMoneySpaces(owner, { status: query.status ?? "all" }));
    } catch (error) {
      sendLabelError(reply, error);
    }
  });

  app.post("/api/v1/money-spaces", async (request, reply) => {
    const owner = await accountId(request, reply, options.sessions);
    if (owner === null) return;
    const key = idempotencyKey(request);
    if (key === null) {
      await reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      return;
    }
    const body = request.body as { name?: string };
    try {
      if (typeof body.name !== "string") throw new LabelServiceError("VALIDATION_ERROR");
      await reply.code(201).send(
        await options.labels.createMoneySpace(owner, {
          idempotencyKey: key,
          name: body.name,
        }),
      );
    } catch (error) {
      sendLabelError(reply, error);
    }
  });

  app.patch("/api/v1/money-spaces/:moneySpaceId", async (request, reply) => {
    const owner = await accountId(request, reply, options.sessions);
    if (owner === null) return;
    const id = (request.params as { moneySpaceId: string }).moneySpaceId;
    const body = request.body as {
      expectedRevision?: string;
      name?: string;
      status?: LabelStatus;
    };
    try {
      if (body.expectedRevision === undefined) throw new LabelServiceError("VALIDATION_ERROR");
      if (body.name !== undefined && body.status === undefined) {
        await reply.code(200).send(
          await options.labels.renameMoneySpace(owner, id, {
            expectedRevision: body.expectedRevision,
            name: body.name,
          }),
        );
        return;
      }
      if (body.status === "inactive" && body.name === undefined) {
        await reply
          .code(200)
          .send(await options.labels.deactivateMoneySpace(owner, id, body.expectedRevision));
        return;
      }
      if (body.status === "active" && body.name === undefined) {
        await reply
          .code(200)
          .send(await options.labels.restoreMoneySpace(owner, id, body.expectedRevision));
        return;
      }
      throw new LabelServiceError("VALIDATION_ERROR");
    } catch (error) {
      sendLabelError(reply, error);
    }
  });
}
