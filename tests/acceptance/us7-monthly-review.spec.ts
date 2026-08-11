import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { createDraft } from "../../apps/server/src/modules/draft/draft.service.js";

const API = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const PASSWORD = "Acceptance-Password-1!";
const RUNTIME_DATABASE_URL = "postgresql://cashmemo:cashmemo-local-only@127.0.0.1:5432/cashmemo";

async function signupAndVerify(request: APIRequestContext, email: string): Promise<void> {
  expect(
    (
      await request.post(`${API}/api/v1/auth/sign-up`, {
        data: { email, idempotencyKey: crypto.randomUUID(), password: PASSWORD },
        failOnStatusCode: false,
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${MAILPIT}/api/v1/messages`)).json()) as { total: number })
          .total,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const list = (await (await request.get(`${MAILPIT}/api/v1/messages`)).json()) as {
    messages: { ID: string }[];
  };
  const message = (await (
    await request.get(`${MAILPIT}/api/v1/message/${list.messages[0]?.ID ?? ""}`)
  ).json()) as { Text: string };
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
  return response.headers()["set-cookie"]?.split(";")[0] ?? "";
}

async function browserLogin(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("monthly-review")).toBeVisible({ timeout: 10_000 });
}

async function selectMonth(page: Page, month: string): Promise<void> {
  await page.getByLabel("Calendar month").fill(month);
  await page.getByRole("button", { name: "Review month" }).click();
}

async function onboard(
  request: APIRequestContext,
  cookie: string,
  reportingTimezone = "America/New_York",
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

interface MemoInput {
  readonly amount: string;
  readonly categoryId: string;
  readonly currency: "EUR" | "IDR" | "USD";
  readonly direction: "expense" | "income";
  readonly moneySpaceId: string;
  readonly occurredAt: string;
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
}

async function createMemo(request: APIRequestContext, cookie: string, input: MemoInput) {
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
      captureStartedAt: "2026-03-09T10:00:00Z",
      captureTimezone: "UTC",
      origin: "manual",
      sourceCompleteness: "incomplete",
      sourceText: null,
    });
  } finally {
    await pool.end();
  }
}

test.describe("US7 — Review a month deterministically", () => {
  test("exact multi-currency review covers ranking, prior zero, negative net, and eligibility", async ({
    page,
    request,
  }) => {
    const email = `us7-review-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, email);
    const cookie = await login(request, email);
    await onboard(request, cookie);
    const income = await createCategory(request, cookie, "income", "Synthetic income");
    const alpha = await createCategory(request, cookie, "expense", "Alpha synthetic");
    const beta = await createCategory(request, cookie, "expense", "Beta synthetic");
    const gamma = await createCategory(request, cookie, "expense", "Gamma synthetic");
    const space = await createSpace(request, cookie, "Synthetic review context");

    await createMemo(request, cookie, {
      amount: "50.00",
      categoryId: alpha.id,
      currency: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-02-10T10:00:00Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    await createMemo(request, cookie, {
      amount: "7.00",
      categoryId: gamma.id,
      currency: "IDR",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-02-12T10:00:00Z",
      planningStatus: "unplanned",
      purpose: "mixed",
    });
    await createMemo(request, cookie, {
      amount: "100.00",
      categoryId: income.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-03-01T05:00:00Z",
      planningStatus: "planned",
      purpose: "work",
    });
    await createMemo(request, cookie, {
      amount: "30.00",
      categoryId: alpha.id,
      currency: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-03-10T10:00:00Z",
      planningStatus: "unplanned",
      purpose: "personal",
    });
    await createMemo(request, cookie, {
      amount: "30.00",
      categoryId: beta.id,
      currency: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-03-11T10:00:00Z",
      planningStatus: "planned",
      purpose: "work",
    });
    const archived = await createMemo(request, cookie, {
      amount: "10.00",
      categoryId: gamma.id,
      currency: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-03-12T10:00:00Z",
      planningStatus: "unplanned",
      purpose: "mixed",
    });
    expect(
      (
        await request.post(`${API}/api/v1/memos/${archived.id}/archive`, {
          data: { expectedRevision: archived.revision },
          headers: { Cookie: cookie },
        })
      ).status(),
    ).toBe(200);
    await createMemo(request, cookie, {
      amount: "10.00",
      categoryId: income.id,
      currency: "EUR",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-03-14T10:00:00Z",
      planningStatus: "planned",
      purpose: "work",
    });
    await createMemo(request, cookie, {
      amount: "25.00",
      categoryId: gamma.id,
      currency: "EUR",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-03-15T10:00:00Z",
      planningStatus: "unplanned",
      purpose: "work",
    });
    const deleted = await createMemo(request, cookie, {
      amount: "99.00",
      categoryId: gamma.id,
      currency: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      occurredAt: "2026-03-16T10:00:00Z",
      planningStatus: "unplanned",
      purpose: "personal",
    });
    expect(
      (
        await request.post(`${API}/api/v1/memos/${deleted.id}/recently-deleted`, {
          data: { expectedRevision: deleted.revision },
          headers: { Cookie: cookie },
        })
      ).status(),
    ).toBe(200);
    await createNonAuthoritativeDraft(await accountId(request, cookie));

    const response = await request.get(`${API}/api/v1/reviews/monthly/2026-03`, {
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
        largestExpenseCategories: { label: string }[];
        netMinor: string;
        priorMonth: {
          absoluteChangeMinor: string;
          percentageChange: string | null;
          percentageUnavailableReason: string | null;
        };
        unplannedExpenseMinor: string;
      }[];
    };
    expect(body.currencies.map((section) => section.currency)).toEqual(["EUR", "IDR", "USD"]);
    expect(body.currencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: "EUR",
          expenseMinor: "2500",
          incomeMinor: "1000",
          netMinor: "-1500",
          priorMonth: expect.objectContaining({
            absoluteChangeMinor: "2500",
            percentageChange: null,
            percentageUnavailableReason: "PRIOR_VALUE_ZERO",
          }),
        }),
        expect.objectContaining({
          currency: "USD",
          expenseMinor: "7000",
          incomeMinor: "10000",
          netMinor: "3000",
          priorMonth: expect.objectContaining({ percentageChange: "40" }),
          unplannedExpenseMinor: "4000",
        }),
      ]),
    );
    expect(
      body.currencies.find((section) => section.currency === "USD")?.largestExpenseCategories,
    ).toEqual([
      expect.objectContaining({ label: "Alpha synthetic" }),
      expect.objectContaining({ label: "Beta synthetic" }),
      expect.objectContaining({ label: "Gamma synthetic" }),
    ]);

    await browserLogin(page, email);
    await selectMonth(page, "2026-03");
    await expect(page.getByTestId("monthly-USD-income")).toHaveText("USD 100.00");
    await expect(page.getByTestId("monthly-USD-expenses")).toHaveText("USD 70.00");
    await expect(page.getByTestId("monthly-EUR-net")).toHaveText("EUR -15.00");
    await expect(page.getByTestId("monthly-EUR-prior-zero")).toBeVisible();
    await expect(page.getByTestId("monthly-USD-categories").locator("li")).toHaveText([
      "Alpha synthetic USD 30.00",
      "Beta synthetic USD 30.00",
      "Gamma synthetic USD 10.00",
    ]);
    await expect(
      page.getByText(/grand total|base currency|converted total|generated insight/iu),
    ).toHaveCount(0);
    expect(page.url()).not.toMatch(/100\.00|70\.00|25\.00|incomeMinor|expenseMinor/iu);
  });

  test("reporting-zone boundary, valid empty state, and second-account isolation agree", async ({
    page,
    request,
  }) => {
    const emailA = `us7-zone-a-${Date.now()}@cashmemo.test`;
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
      occurredAt: "2026-02-28T17:00:00Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    await createMemo(request, cookieA, {
      amount: "20.00",
      categoryId: category.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-02-28T16:59:59.999Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    const accountA = (await (
      await request.get(`${API}/api/v1/reviews/monthly/2026-03`, {
        headers: { Cookie: cookieA },
      })
    ).json()) as { currencies: { currency: string; incomeMinor: string }[] };
    expect(accountA.currencies).toEqual([
      expect.objectContaining({ currency: "USD", incomeMinor: "1000" }),
    ]);

    const emailB = `us7-zone-b-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, emailB);
    const cookieB = await login(request, emailB);
    await onboard(request, cookieB, "Asia/Jakarta");
    const accountB = await request.get(`${API}/api/v1/reviews/monthly/2026-03`, {
      headers: { Cookie: cookieB },
    });
    expect(accountB.status()).toBe(200);
    expect(await accountB.json()).toMatchObject({ currencies: [] });
    await browserLogin(page, emailB);
    await selectMonth(page, "2026-03");
    await expect(page.getByTestId("monthly-review-empty")).toHaveText("No activity in this month");
    await expect(page.getByTestId("monthly-review-currencies")).toHaveCount(0);
    expect(page.url()).not.toMatch(/1000|2000|incomeMinor/iu);
  });

  test("calculation failure clears prior values while history and capture remain available", async ({
    page,
    request,
  }) => {
    const email = `us7-failure-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, email);
    const cookie = await login(request, email);
    await onboard(request, cookie);
    const category = await createCategory(request, cookie, "income", "Synthetic recovery");
    const space = await createSpace(request, cookie, "Synthetic recovery context");
    await createMemo(request, cookie, {
      amount: "12.00",
      categoryId: category.id,
      currency: "USD",
      direction: "income",
      moneySpaceId: space.id,
      occurredAt: "2026-03-08T10:00:00Z",
      planningStatus: "planned",
      purpose: "work",
    });
    await browserLogin(page, email);
    await selectMonth(page, "2026-03");
    await expect(page.getByTestId("monthly-USD-income")).toHaveText("USD 12.00");

    await onboard(request, cookie, "Invalid/Reporting-Zone");
    await page.getByRole("button", { name: "Review month" }).click();
    await expect(page.getByTestId("monthly-review-unavailable")).toHaveText(
      /Monthly review calculation unavailable/u,
    );
    await expect(page.getByTestId("monthly-review-currencies")).toHaveCount(0);
    await expect(
      page.getByTestId("monthly-review").getByText("USD 12.00", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.get(`${API}/api/v1/memos`, {
          headers: { Cookie: cookie },
          failOnStatusCode: false,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await createMemo(request, cookie, {
          amount: "13.00",
          categoryId: category.id,
          currency: "USD",
          direction: "income",
          moneySpaceId: space.id,
          occurredAt: "2026-03-09T10:00:00Z",
          planningStatus: "unplanned",
          purpose: "work",
        })
      ).id,
    ).toBeTruthy();
    const failed = await request.get(`${API}/api/v1/reviews/monthly/2026-03`, {
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(failed.status()).toBe(503);
    expect(await failed.json()).toMatchObject({
      code: "CALCULATION_UNAVAILABLE",
      messageCode: "MONTHLY_REVIEW_CALCULATION_UNAVAILABLE",
    });
    expect(page.url()).not.toMatch(/12\.00|13\.00|amount|total/iu);
  });
});
