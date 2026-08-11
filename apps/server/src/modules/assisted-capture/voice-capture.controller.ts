import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { SessionService } from "../identity/session.service.js";
import { getDraft, updateDraft } from "../draft/draft.service.js";
import type { Pool } from "pg";
import { TextExtractionError, type TextExtractionService } from "./text-extraction.service.js";
import type { SupportedAudioMediaType } from "./provider-ports.js";
import { AudioAdmissionError } from "./temporary-audio.service.js";
import { VoiceCaptureError, type VoiceCaptureService } from "./voice-capture.service.js";
import { DraftConfirmationError, type ConfirmDraftService } from "./confirm-draft.service.js";

interface Options {
  readonly pool: Pool;
  readonly confirmation: ConfirmDraftService;
  readonly sessions: SessionService;
  readonly text: TextExtractionService;
  readonly voice: VoiceCaptureService;
}

function headers(request: FastifyRequest): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) result.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return result;
}

async function owner(request: FastifyRequest, reply: FastifyReply, sessions: SessionService) {
  const session = await sessions.authenticate(headers(request));
  if (session !== null) return session.accountId;
  await reply.code(401).send({ messageCode: "UNAUTHENTICATED" });
  return null;
}

function privateResponse(reply: FastifyReply): void {
  reply.header("cache-control", "private, no-store, max-age=0");
  reply.header("pragma", "no-cache");
}

function key(request: FastifyRequest): string | null {
  const value = request.headers["idempotency-key"] ?? request.headers["x-idempotency-key"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof DraftConfirmationError) {
    const status =
      error.code === "DRAFT_NOT_FOUND"
        ? 404
        : error.code === "PRIVACY_BOUNDARY_BLOCKED"
          ? 422
          : error.code === "VALIDATION_ERROR"
            ? 400
            : 409;
    void reply.code(status).send({ messageCode: error.code });
    return;
  }
  if (error instanceof TextExtractionError) {
    const status =
      error.code === "PRIVACY_BOUNDARY_BLOCKED"
        ? 422
        : error.code === "VALIDATION_FAILED"
          ? 400
          : 503;
    void reply.code(status).send({ messageCode: error.code });
    return;
  }
  if (error instanceof VoiceCaptureError) {
    const status =
      error.code === "CAPTURE_NOT_FOUND"
        ? 404
        : error.code === "PROVIDER_CONSENT_REQUIRED"
          ? 422
          : 409;
    void reply.code(status).send({ messageCode: error.code });
    return;
  }
  if (error instanceof AudioAdmissionError) {
    void reply.code(422).send({ messageCode: "AUDIO_INVALID" });
    return;
  }
  if (error instanceof Error && ["DRAFT_NOT_FOUND", "REVISION_CONFLICT"].includes(error.message)) {
    void reply
      .code(error.message === "DRAFT_NOT_FOUND" ? 404 : 409)
      .send({ messageCode: error.message });
    return;
  }
  void reply.code(500).send({ messageCode: "ASSISTED_CAPTURE_UNAVAILABLE" });
}

const mediaTypes = new Set<SupportedAudioMediaType>([
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

export function registerAssistedCaptureRoutes(
  app: FastifyInstance,
  options: Readonly<Options>,
): void {
  app.post("/api/v1/drafts/text-extraction", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    if (accountId === null) return;
    try {
      const body = request.body as Parameters<TextExtractionService["extract"]>[1];
      await reply.code(202).send(await options.text.extract(accountId, body));
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/v1/drafts/:draftId", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    if (accountId === null) return;
    try {
      await reply.send(
        await getDraft(options.pool, accountId, (request.params as { draftId: string }).draftId),
      );
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.patch("/api/v1/drafts/:draftId", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    if (accountId === null) return;
    const body = request.body as {
      candidateFields?: Record<string, unknown>;
      expectedRevision?: string;
      sourceCompleteness?: string;
      sourceText?: string | null;
    };
    if (body.expectedRevision === undefined || body.candidateFields === undefined) {
      await reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      return;
    }
    try {
      await reply.send(
        await updateDraft(
          options.pool,
          accountId,
          (request.params as { draftId: string }).draftId,
          {
            candidateFields: body.candidateFields,
            sourceCompleteness: body.sourceCompleteness ?? "complete",
            sourceText: body.sourceText ?? null,
          },
          body.expectedRevision,
        ),
      );
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/v1/drafts/:draftId/confirm", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    const idempotencyKey = key(request);
    if (accountId === null) return;
    if (idempotencyKey === null) {
      await reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      return;
    }
    try {
      await reply
        .code(201)
        .send(
          await options.confirmation.confirm(
            accountId,
            (request.params as { draftId: string }).draftId,
            idempotencyKey,
            request.body as Parameters<ConfirmDraftService["confirm"]>[3],
          ),
        );
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/v1/voice-captures", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    const idempotencyKey = key(request);
    if (accountId === null) return;
    if (idempotencyKey === null) {
      await reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      return;
    }
    try {
      await reply
        .code(201)
        .send(
          await options.voice.start(
            accountId,
            idempotencyKey,
            request.body as Parameters<VoiceCaptureService["start"]>[2],
          ),
        );
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.put("/api/v1/voice-captures/:captureId/audio", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    const idempotencyKey = key(request);
    const raw = (request.headers["content-type"] ?? "").split(";", 1)[0] as SupportedAudioMediaType;
    if (accountId === null) return;
    if (idempotencyKey === null || !mediaTypes.has(raw) || !Buffer.isBuffer(request.body)) {
      await reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      return;
    }
    try {
      await reply.send(
        await options.voice.upload(
          accountId,
          (request.params as { captureId: string }).captureId,
          idempotencyKey,
          request.body,
          raw,
        ),
      );
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/v1/voice-captures/:captureId", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    if (accountId === null) return;
    try {
      await reply.send(
        await options.voice.status(accountId, (request.params as { captureId: string }).captureId),
      );
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete("/api/v1/voice-captures/:captureId", async (request, reply) => {
    privateResponse(reply);
    const accountId = await owner(request, reply, options.sessions);
    if (accountId === null) return;
    const expectedRevision = (request.body as { expectedRevision?: string } | undefined)
      ?.expectedRevision;
    if (expectedRevision === undefined) {
      await reply.code(400).send({ messageCode: "VALIDATION_ERROR" });
      return;
    }
    try {
      await reply.send(
        await options.voice.cancel(
          accountId,
          (request.params as { captureId: string }).captureId,
          expectedRevision,
        ),
      );
    } catch (error) {
      sendError(reply, error);
    }
  });
}
