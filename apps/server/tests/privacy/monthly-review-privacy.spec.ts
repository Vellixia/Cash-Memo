import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  registerMonthlyReviewRoutes,
  type MonthlyReviewReader,
} from "../../src/modules/reporting/monthly-review.controller.js";
import type { MonthlyReviewView } from "../../src/modules/reporting/monthly-review.service.js";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000091";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000092";

function review(account: "a" | "b" = "a"): MonthlyReviewView {
  const amount = account === "a" ? "13579" : "24680";
  return {
    calculatedAt: "2026-03-20T12:00:00.000Z",
    currencies: [
      {
        currency: "USD",
        currencyExponent: 2,
        expenseMinor: amount,
        incomeMinor: "0",
        largestExpenseCategories: [
          { amountMinor: amount, key: `${account}-category`, label: "Private bucket" },
        ],
        netMinor: `-${amount}`,
        priorMonth: {
          absoluteChangeMinor: amount,
          expenseMinor: "0",
          percentageChange: null,
          percentageUnavailableReason: "PRIOR_VALUE_ZERO",
        },
        unplannedExpenseMinor: amount,
      },
    ],
    month: "2026-03",
    priorMonth: "2026-02",
    reportingTimezone: "America/New_York",
  };
}

function authenticatedSessions() {
  return {
    authenticate(headers: Headers) {
      const account = headers.get("x-test-account");
      if (account !== ACCOUNT_A && account !== ACCOUNT_B) return Promise.resolve(null);
      return Promise.resolve({ accountId: account, sessionId: `session-${account}` });
    },
  };
}

async function buildApp(reader: MonthlyReviewReader) {
  const app = Fastify({ logger: false });
  registerMonthlyReviewRoutes(app, { monthlyReview: reader, sessions: authenticatedSessions() });
  await app.ready();
  return app;
}

describe("monthly-review privacy, cache, and failure boundary", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("marks authenticated financial responses private and no-store", async () => {
    const app = await buildApp({ getMonthlyReview: () => Promise.resolve(review()) });
    apps.push(app);
    const response = await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/reviews/monthly/2026-03",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers.vary).toBe("Cookie");
  });

  it.each(["2026-00", "2026-13", "2026-3", "03-2026", "2026-03-01"])(
    "rejects non-canonical period %s without echoing it",
    async (month) => {
      const app = await buildApp({ getMonthlyReview: () => Promise.resolve(review()) });
      apps.push(app);
      const response = await app.inject({
        headers: { "x-test-account": ACCOUNT_A },
        method: "GET",
        url: `/api/v1/reviews/monthly/${month}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        messageCode: "INVALID_REPORTING_MONTH",
        retryable: false,
      });
      expect(response.body).not.toContain(month);
    },
  );

  it("returns named content-free unavailable semantics and no partial result", async () => {
    const app = await buildApp({
      getMonthlyReview: () => Promise.reject(new Error("private total 13579 Private bucket")),
    });
    apps.push(app);
    const response = await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/reviews/monthly/2026-03",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "CALCULATION_UNAVAILABLE",
      fieldErrors: [],
      messageCode: "MONTHLY_REVIEW_CALCULATION_UNAVAILABLE",
      retryable: true,
    });
    expect(response.body).not.toMatch(/13579|Private bucket|amount|income|expense|currency|sql/iu);
  });

  it("does not replay a prior result after a calculation failure", async () => {
    let calls = 0;
    const app = await buildApp({
      getMonthlyReview: () =>
        ++calls === 1 ? Promise.resolve(review()) : Promise.reject(new Error("13579")),
    });
    apps.push(app);
    const request = {
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET" as const,
      url: "/api/v1/reviews/monthly/2026-03",
    };
    expect((await app.inject(request)).body).toContain("13579");
    const failed = await app.inject(request);
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("13579");
  });

  it("isolates account values and emits no financial telemetry", async () => {
    const emitted: string[] = [];
    const app = await buildApp({
      getMonthlyReview: (accountId) => Promise.resolve(review(accountId === ACCOUNT_A ? "a" : "b")),
    });
    apps.push(app);
    const first = await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/reviews/monthly/2026-03",
    });
    const second = await app.inject({
      headers: { "x-test-account": ACCOUNT_B },
      method: "GET",
      url: "/api/v1/reviews/monthly/2026-03",
    });
    expect(first.body).toContain("13579");
    expect(first.body).not.toContain("24680");
    expect(second.body).toContain("24680");
    expect(second.body).not.toContain("13579");
    expect(emitted).toEqual([]);
  });

  it("keeps history and capture available when monthly review fails", async () => {
    const app = Fastify({ logger: false });
    registerMonthlyReviewRoutes(app, {
      monthlyReview: { getMonthlyReview: () => Promise.reject(new Error("unavailable")) },
      sessions: authenticatedSessions(),
    });
    app.get("/api/v1/memos", () => ({ items: [] }));
    app.post("/api/v1/memos", (_request, reply) => reply.code(201).send({ status: "created" }));
    await app.ready();
    apps.push(app);
    const headers = { "x-test-account": ACCOUNT_A };
    expect(
      (await app.inject({ headers, method: "GET", url: "/api/v1/reviews/monthly/2026-03" }))
        .statusCode,
    ).toBe(503);
    expect((await app.inject({ method: "GET", url: "/api/v1/memos" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/memos" })).statusCode).toBe(201);
  });
});
