import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { createDraft } from "../../apps/server/src/modules/draft/draft.service.js";

const API = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const PASSWORD = "Acceptance-Password-1!";
const RUNTIME_DATABASE_URL = "postgresql://cashmemo:cashmemo-local-only@127.0.0.1:5432/cashmemo";

async function signupAndVerify(request: APIRequestContext, email: string): Promise<void> {
  const signup = await request.post(`${API}/api/v1/auth/sign-up`, {
    data: { email, idempotencyKey: crypto.randomUUID(), password: PASSWORD },
    failOnStatusCode: false,
  });
  expect(signup.status()).toBe(202);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${MAILPIT}/api/v1/messages`)).json()) as { total: number })
          .total,
      {
        timeout: 10_000,
      },
    )
    .toBeGreaterThan(0);
  const list = (await (await request.get(`${MAILPIT}/api/v1/messages`)).json()) as {
    messages: { ID: string }[];
  };
  const id = list.messages[0]?.ID;
  expect(id).toBeDefined();
  const message = (await (await request.get(`${MAILPIT}/api/v1/message/${id ?? ""}`)).json()) as {
    Text: string;
  };
  const token = /token=([^&\s]+)/u.exec(message.Text)?.[1];
  expect(token).toBeDefined();
  expect(
    (await request.post(`${API}/api/v1/auth/verify-email`, { data: { token } })).status(),
  ).toBe(204);
  await request.delete(`${MAILPIT}/api/v1/messages`);
}

async function login(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post(`${API}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);
  const cookie = response.headers()["set-cookie"];
  return cookie?.split(";")[0] ?? "";
}

async function browserLogin(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("current-month-overview")).toBeVisible({ timeout: 10_000 });
}

async function onboard(
  request: APIRequestContext,
  cookie: string,
  reportingTimezone = "Asia/Jakarta",
): Promise<void> {
  const response = await request.put(`${API}/api/v1/me/onboarding`, {
    data: {
      defaultCurrency: "USD",
      locale: "en-US",
      privacyNoticeVersion: "1.0",
      reportingTimezone,
    },
    headers: { Cookie: cookie },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);
}

async function createCategory(
  request: APIRequestContext,
  cookie: string,
  kind: "expense" | "income",
  name: string,
) {
  const response = await request.post(`${API}/api/v1/categories`, {
    data: { kind, name },
    headers: { Cookie: cookie, "Idempotency-Key": crypto.randomUUID() },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string }>;
}

async function createSpace(request: APIRequestContext, cookie: string, name: string) {
  const response = await request.post(`${API}/api/v1/money-spaces`, {
    data: { name },
    headers: { Cookie: cookie, "Idempotency-Key": crypto.randomUUID() },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string }>;
}

async function createMemo(
  request: APIRequestContext,
  cookie: string,
  input: {
    amount: string;
    categoryId: string;
    currency: "EUR" | "IDR" | "USD";
    direction: "expense" | "income";
    moneySpaceId: string;
    occurredAt: string;
    planningStatus: "planned" | "unplanned" | null;
    purpose: "mixed" | "personal" | "work" | null;
  },
) {
  const response = await request.post(`${API}/api/v1/memos`, {
    data: {
      categoryId: input.categoryId,
      confirmation: "CONFIRM_MONEY_MEMO",
      direction: input.direction,
      money: { amount: input.amount, currency: input.currency },
      moneySpaceId: input.moneySpaceId,
      note: null,
      occurrence: {
        occurredAt: input.occurredAt,
        occurredLocal: input.occurredAt.slice(0, 19),
        occurredOffsetMinutes: 0,
        occurredTimezone: "UTC",
        timezoneDatabaseVersion: "system-local",
      },
      planningStatus: input.planningStatus,
      purpose: input.purpose,
    },
    headers: { Cookie: cookie, "x-idempotency-key": crypto.randomUUID() },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; revision: string }>;
}

async function accountId(request: APIRequestContext, cookie: string): Promise<string> {
  const response = await request.get(`${API}/api/v1/me`, { headers: { Cookie: cookie } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { userId: string }).userId;
}

async function createNonAuthoritativeDraft(ownerId: string): Promise<void> {
  const pool = new Pool({
    connectionString: RUNTIME_DATABASE_URL,
    options: "-c role=cashmemo_runtime",
  });
  try {
    await createDraft(pool, ownerId, {
      candidateFields: { amount: "77.00", currency: "USD", direction: "income" },
      captureStartedAt: "2026-08-09T10:00:00Z",
      captureTimezone: "UTC",
      origin: "manual",
      sourceCompleteness: "incomplete",
      sourceText: null,
    });
  } finally {
    await pool.end();
  }
}

test.describe("US4 — Understand current month", () => {
  test("browser renders exact per-currency totals, buckets, recent active memos, and eligibility", async ({
    page,
    request,
  }) => {
    const email = `us4-overview-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, email);
    const cookie = await login(request, email);
    await onboard(request, cookie);
    const income = await createCategory(request, cookie, "income", "Synthetic income");
    const expense = await createCategory(request, cookie, "expense", "Synthetic expense");
    const space = await createSpace(request, cookie, "Synthetic context");
    await createMemo(request, cookie, {
      amount: "100.00",
      categoryId: income.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-08-03T10:00:00Z",
      planningStatus: "planned",
      purpose: "work",
    });
    const archived = await createMemo(request, cookie, {
      amount: "25.00",
      categoryId: expense.id,
      currency: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-08-04T10:00:00Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    expect(
      (
        await request.post(`${API}/api/v1/memos/${archived.id}/archive`, {
          data: { expectedRevision: archived.revision },
          headers: { Cookie: cookie },
          failOnStatusCode: false,
        })
      ).status(),
    ).toBe(200);
    await createMemo(request, cookie, {
      amount: "40.00",
      categoryId: expense.id,
      currency: "EUR",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-08-05T10:00:00Z",
      planningStatus: "unplanned",
      purpose: "mixed",
    });
    const deleted = await createMemo(request, cookie, {
      amount: "99.00",
      categoryId: expense.id,
      currency: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-08-06T10:00:00Z",
      planningStatus: null,
      purpose: null,
    });
    expect(
      (
        await request.post(`${API}/api/v1/memos/${deleted.id}/recently-deleted`, {
          data: { expectedRevision: deleted.revision },
          headers: { Cookie: cookie },
          failOnStatusCode: false,
        })
      ).status(),
    ).toBe(200);
    await createNonAuthoritativeDraft(await accountId(request, cookie));

    const response = await request.get(`${API}/api/v1/overview/current-month`, {
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const body = (await response.json()) as {
      currencies: {
        currency: string;
        expenseMinor: string;
        incomeMinor: string;
        netMinor: string;
      }[];
      recentMemos: { id: string }[];
    };
    expect(body.currencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: "EUR",
          expenseMinor: "4000",
          incomeMinor: "0",
          netMinor: "-4000",
        }),
        expect.objectContaining({
          currency: "USD",
          expenseMinor: "2500",
          incomeMinor: "10000",
          netMinor: "7500",
        }),
      ]),
    );
    expect(body.recentMemos.map((memo) => memo.id)).not.toContain(archived.id);
    expect(body.recentMemos.map((memo) => memo.id)).not.toContain(deleted.id);

    await browserLogin(page, email);
    await expect(page.getByTestId("USD-income")).toHaveText("USD 100.00");
    await expect(page.getByTestId("USD-expenses")).toHaveText("USD 25.00");
    await expect(page.getByTestId("USD-net")).toHaveText("USD 75.00");
    await expect(page.getByTestId("EUR-net")).toHaveText("EUR -40.00");
    await expect(page.getByTestId("current-month-recent-memos")).toBeVisible();
    await expect(
      page.getByText(/grand total|base currency|exchange rate|converted total/iu),
    ).toHaveCount(0);
    expect(page.url()).not.toMatch(/100\.00|25\.00|40\.00|currency|amount/iu);
  });

  test("reporting-zone boundary, empty presentation, and second-account isolation agree", async ({
    page,
    request,
  }) => {
    const emailA = `us4-zone-a-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, emailA);
    const cookieA = await login(request, emailA);
    await onboard(request, cookieA, "Asia/Jakarta");
    const category = await createCategory(request, cookieA, "income", "Synthetic boundary");
    const space = await createSpace(request, cookieA, "Synthetic boundary context");
    await createMemo(request, cookieA, {
      amount: "10.00",
      categoryId: category.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-07-31T17:00:00Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    await createMemo(request, cookieA, {
      amount: "20.00",
      categoryId: category.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-07-31T16:59:59.999Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    const accountA = (await (
      await request.get(`${API}/api/v1/overview/current-month`, { headers: { Cookie: cookieA } })
    ).json()) as { currencies: { currency: string; incomeMinor: string }[] };
    expect(accountA.currencies).toEqual([
      expect.objectContaining({ currency: "USD", incomeMinor: "1000" }),
    ]);

    const emailB = `us4-zone-b-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, emailB);
    const cookieB = await login(request, emailB);
    await onboard(request, cookieB, "Asia/Jakarta");
    const accountBResponse = await request.get(`${API}/api/v1/overview/current-month`, {
      headers: { Cookie: cookieB },
    });
    expect(accountBResponse.status()).toBe(200);
    expect((await accountBResponse.json()) as { currencies: unknown[] }).toMatchObject({
      currencies: [],
    });
    await browserLogin(page, emailB);
    await expect(page.getByTestId("current-month-empty")).toHaveText("No activity this month");
    await expect(page.getByTestId("current-month-currencies")).toHaveCount(0);
    expect(page.url()).not.toMatch(/1000|2000|incomeMinor/iu);
  });

  test("calculation failure presents no stale partials while history and manual capture remain usable", async ({
    page,
    request,
  }) => {
    const email = `us4-failure-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, email);
    const cookie = await login(request, email);
    await onboard(request, cookie, "Asia/Jakarta");
    const category = await createCategory(request, cookie, "income", "Synthetic recovery");
    const space = await createSpace(request, cookie, "Synthetic recovery context");
    await createMemo(request, cookie, {
      amount: "12.00",
      categoryId: category.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-08-08T10:00:00Z",
      planningStatus: "planned",
      purpose: "work",
    });
    await browserLogin(page, email);
    await expect(page.getByTestId("USD-income")).toHaveText("USD 12.00");

    await onboard(request, cookie, "Invalid/Reporting-Zone");
    await page.reload();
    await expect(page.getByTestId("current-month-unavailable")).toHaveText(
      /Current-month calculation unavailable/u,
    );
    await expect(page.getByTestId("current-month-currencies")).toHaveCount(0);
    await expect(page.getByText("USD 12.00", { exact: true })).toHaveCount(0);
    const history = await request.get(`${API}/api/v1/memos`, {
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(history.status()).toBe(200);
    const captured = await createMemo(request, cookie, {
      amount: "13.00",
      categoryId: category.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-08-09T10:00:00Z",
      planningStatus: "unplanned",
      purpose: "work",
    });
    expect(captured.id).toBeTruthy();
    const failed = await request.get(`${API}/api/v1/overview/current-month`, {
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(failed.status()).toBe(503);
    expect(await failed.json()).toMatchObject({
      code: "CALCULATION_UNAVAILABLE",
      messageCode: "CURRENT_MONTH_CALCULATION_UNAVAILABLE",
    });
    expect(page.url()).not.toMatch(/12\.00|13\.00|amount|total/iu);
  });
});
