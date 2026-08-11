import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  registerCurrentMonthRoutes,
  type CurrentMonthReader,
} from "../../src/modules/reporting/current-month.controller.js";
import {
  CurrentMonthUnavailableError,
  type CurrentMonthOverview,
} from "../../src/modules/reporting/current-month.service.js";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000071";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000072";

function overview(account: "a" | "b" = "a"): CurrentMonthOverview {
  const amount = account === "a" ? "13579" : "24680";
  return {
    calculatedAt: "2026-08-11T00:00:00.000Z",
    currencies: [
      {
        categoryBreakdown: [{ amountMinor: amount, key: `${account}-category`, label: "Bucket" }],
        currency: "USD",
        currencyExponent: 2,
        expenseMinor: "0",
        incomeMinor: amount,
        netMinor: amount,
        planningBreakdown: [{ amountMinor: amount, key: "planned", label: "Planned" }],
        purposeBreakdown: [{ amountMinor: amount, key: "work", label: "Work" }],
      },
    ],
    period: "2026-08",
    recentMemos: [],
    reportingTimezone: "Asia/Jakarta",
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

async function buildApp(reader: CurrentMonthReader) {
  const app = Fastify({ logger: false });
  registerCurrentMonthRoutes(app, { currentMonth: reader, sessions: authenticatedSessions() });
  await app.ready();
  return app;
}

describe("current-month privacy, cache, and failure boundary", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("marks every protected overview response private and no-store", async () => {
    const app = await buildApp({
      getCurrentMonth() {
        return Promise.resolve(overview());
      },
    });
    apps.push(app);
    const response = await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/overview/current-month",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers.vary).toBe("Cookie");
  });

  it("returns a named, content-free unavailable error without partial financial data", async () => {
    const app = await buildApp({
      getCurrentMonth() {
        return Promise.reject(new CurrentMonthUnavailableError());
      },
    });
    apps.push(app);
    const response = await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/overview/current-month",
    });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      code: "CALCULATION_UNAVAILABLE",
      fieldErrors: [],
      messageCode: "CURRENT_MONTH_CALCULATION_UNAVAILABLE",
      retryable: true,
    });
    expect(response.body).not.toMatch(/amount|bucket|currency|income|expense|memo|sql/iu);
  });

  it("never replays a prior successful overview as current after calculation failure", async () => {
    let calls = 0;
    const app = await buildApp({
      getCurrentMonth() {
        calls += 1;
        return calls === 1
          ? Promise.resolve(overview())
          : Promise.reject(new Error("private stale candidate 13579 Bucket"));
      },
    });
    apps.push(app);
    const request = {
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET" as const,
      url: "/api/v1/overview/current-month",
    };
    expect((await app.inject(request)).statusCode).toBe(200);
    const failed = await app.inject(request);
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain("13579");
    expect(failed.body).not.toContain("Bucket");
  });

  it("does not emit financial values to logs, traces, metrics, analytics, or diagnostics", async () => {
    const emitted: string[] = [];
    const app = await buildApp({
      getCurrentMonth() {
        return Promise.resolve(overview());
      },
    });
    apps.push(app);
    await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/overview/current-month",
    });
    expect(emitted).toEqual([]);
    expect(JSON.stringify(emitted)).not.toMatch(/13579|Bucket|USD|planned|work/u);
  });

  it("keeps capture and history available when overview calculation fails", async () => {
    const app = Fastify({ logger: false });
    registerCurrentMonthRoutes(app, {
      currentMonth: {
        getCurrentMonth() {
          return Promise.reject(new CurrentMonthUnavailableError());
        },
      },
      sessions: authenticatedSessions(),
    });
    app.get("/api/v1/memos", () => ({ items: [], nextCursor: null }));
    app.post("/api/v1/memos", (_request, reply) => reply.code(201).send({ status: "created" }));
    await app.ready();
    apps.push(app);
    const overviewResponse = await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/overview/current-month",
    });
    const history = await app.inject({ method: "GET", url: "/api/v1/memos" });
    const capture = await app.inject({ method: "POST", url: "/api/v1/memos" });
    expect(overviewResponse.statusCode).toBe(503);
    expect(history.statusCode).toBe(200);
    expect(capture.statusCode).toBe(201);
  });

  it("returns only the authenticated account's values and no cross-user diagnostics", async () => {
    const diagnostics: string[] = [];
    const app = await buildApp({
      getCurrentMonth(accountId) {
        return Promise.resolve(overview(accountId === ACCOUNT_A ? "a" : "b"));
      },
    });
    apps.push(app);
    const first = await app.inject({
      headers: { "x-test-account": ACCOUNT_A },
      method: "GET",
      url: "/api/v1/overview/current-month",
    });
    const second = await app.inject({
      headers: { "x-test-account": ACCOUNT_B },
      method: "GET",
      url: "/api/v1/overview/current-month",
    });
    expect(first.body).toContain("13579");
    expect(first.body).not.toContain("24680");
    expect(second.body).toContain("24680");
    expect(second.body).not.toContain("13579");
    expect(diagnostics).toEqual([]);
  });

  it("keeps unauthenticated failures content-free and non-cacheable", async () => {
    const app = await buildApp({
      getCurrentMonth() {
        return Promise.resolve(overview());
      },
    });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/v1/overview/current-month" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).not.toContain("13579");
  });

  it("keeps authentication backend failures content-free", async () => {
    const app = Fastify({ logger: false });
    registerCurrentMonthRoutes(app, {
      currentMonth: { getCurrentMonth: () => Promise.resolve(overview()) },
      sessions: {
        authenticate: () => Promise.reject(new Error("private authentication diagnostic 13579")),
      },
    });
    await app.ready();
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/v1/overview/current-month" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).not.toContain("13579");
    expect(response.body).not.toContain("authentication diagnostic");
  });
});
