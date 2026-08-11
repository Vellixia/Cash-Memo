import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { SessionService } from "../identity/session.service.js";
import { privateNoStore } from "./current-month.controller.js";
import type { MonthlyReviewView } from "./monthly-review.service.js";

interface MonthlyReviewReader {
  getMonthlyReview(accountId: string, month: string): Promise<MonthlyReviewView>;
}

interface MonthlyReviewControllerOptions {
  readonly monthlyReview: MonthlyReviewReader;
  readonly sessions: Pick<SessionService, "authenticate">;
}

const CANONICAL_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;

function requestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return headers;
}

function productError(code: "CALCULATION_UNAVAILABLE" | "UNAUTHENTICATED" | "VALIDATION_FAILED") {
  const unavailable = code === "CALCULATION_UNAVAILABLE";
  return Object.freeze({
    code,
    correlationId: randomUUID(),
    fieldErrors:
      code === "VALIDATION_FAILED" ? [{ field: "month", reason: "INVALID_REPORTING_MONTH" }] : [],
    messageCode: unavailable
      ? "MONTHLY_REVIEW_CALCULATION_UNAVAILABLE"
      : code === "VALIDATION_FAILED"
        ? "INVALID_REPORTING_MONTH"
        : "UNAUTHENTICATED",
    retryable: unavailable,
  });
}

function registerMonthlyReviewRoutes(
  app: FastifyInstance,
  options: Readonly<MonthlyReviewControllerOptions>,
): void {
  app.get<{ Params: { month: string } }>(
    "/api/v1/reviews/monthly/:month",
    async (request, reply) => {
      privateNoStore(reply);
      if (!CANONICAL_MONTH.test(request.params.month)) {
        await reply.code(400).send(productError("VALIDATION_FAILED"));
        return;
      }
      try {
        const session = await options.sessions.authenticate(requestHeaders(request));
        if (session === null) {
          await reply.code(401).send(productError("UNAUTHENTICATED"));
          return;
        }
        const review = await options.monthlyReview.getMonthlyReview(
          session.accountId,
          request.params.month,
        );
        await reply.code(200).send(review);
      } catch {
        await reply.code(503).send(productError("CALCULATION_UNAVAILABLE"));
      }
    },
  );
}

export {
  CANONICAL_MONTH,
  registerMonthlyReviewRoutes,
  type MonthlyReviewControllerOptions,
  type MonthlyReviewReader,
};
