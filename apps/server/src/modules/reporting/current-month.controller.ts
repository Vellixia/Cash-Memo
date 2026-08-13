import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { SessionAuthenticationPort } from "../identity/application/ports/session-authentication.port.js";
import type { CurrentMonthOverview } from "./current-month.service.js";

interface CurrentMonthReader {
  getCurrentMonth(accountId: string): Promise<CurrentMonthOverview>;
}

interface CurrentMonthControllerOptions {
  readonly currentMonth: CurrentMonthReader;
  readonly sessions: Pick<SessionAuthenticationPort, "authenticate">;
}

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return headers;
}

function privateNoStore(reply: FastifyReply): void {
  void reply.headers({
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    Vary: "Cookie",
  });
}

function productError(code: "CALCULATION_UNAVAILABLE" | "UNAUTHENTICATED") {
  return Object.freeze({
    code,
    correlationId: randomUUID(),
    fieldErrors: [],
    messageCode:
      code === "CALCULATION_UNAVAILABLE"
        ? "CURRENT_MONTH_CALCULATION_UNAVAILABLE"
        : "UNAUTHENTICATED",
    retryable: code === "CALCULATION_UNAVAILABLE",
  });
}

function registerCurrentMonthRoutes(
  app: FastifyInstance,
  options: Readonly<CurrentMonthControllerOptions>,
): void {
  app.get("/api/v1/overview/current-month", async (request, reply) => {
    privateNoStore(reply);
    try {
      const session = await options.sessions.authenticate(requestHeaders(request));
      if (session === null) {
        await reply.code(401).send(productError("UNAUTHENTICATED"));
        return;
      }
      const overview = await options.currentMonth.getCurrentMonth(session.accountId);
      await reply.code(200).send(overview);
    } catch {
      await reply.code(503).send(productError("CALCULATION_UNAVAILABLE"));
    }
  });
}

export {
  privateNoStore,
  registerCurrentMonthRoutes,
  type CurrentMonthControllerOptions,
  type CurrentMonthReader,
};
