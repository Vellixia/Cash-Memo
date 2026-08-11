import { expect, test, type APIRequestContext } from "@playwright/test";

const API = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const PASSWORD = "Acceptance-Password-1!";

async function signupAndVerify(request: APIRequestContext, email: string): Promise<void> {
  const signup = await request.post(`${API}/api/v1/auth/sign-up`, {
    data: { email, idempotencyKey: crypto.randomUUID(), password: PASSWORD },
    failOnStatusCode: false,
  });
  expect(signup.status()).toBe(202);
  await expect
    .poll(
      async () => {
        const response = await request.get(`${MAILPIT}/api/v1/messages`);
        return ((await response.json()) as { total: number }).total;
      },
      { timeout: 10_000 },
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
  const selected = Array.isArray(cookie) ? cookie[0] : cookie;
  return selected?.split(";")[0] ?? "";
}

async function onboard(request: APIRequestContext, cookie: string): Promise<void> {
  const response = await request.put(`${API}/api/v1/me/onboarding`, {
    data: {
      defaultCurrency: "USD",
      locale: "en-US",
      privacyNoticeVersion: "1.0",
      reportingTimezone: "Asia/Jakarta",
    },
    headers: { Cookie: cookie },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);
}

async function createCategory(request: APIRequestContext, cookie: string, name: string) {
  const response = await request.post(`${API}/api/v1/categories`, {
    data: { kind: "expense", name },
    headers: { Cookie: cookie, "Idempotency-Key": crypto.randomUUID() },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; revision: string }>;
}

async function createSpace(request: APIRequestContext, cookie: string, name: string) {
  const response = await request.post(`${API}/api/v1/money-spaces`, {
    data: { name },
    headers: { Cookie: cookie, "Idempotency-Key": crypto.randomUUID() },
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; revision: string }>;
}

async function createMemo(
  request: APIRequestContext,
  cookie: string,
  input: {
    categoryId: string;
    currency: string;
    direction?: "expense" | "income";
    moneySpaceId: string;
    note: string;
    occurredAt: string;
    planningStatus: "planned" | "unplanned" | null;
    purpose: "mixed" | "personal" | "work" | null;
  },
) {
  const response = await request.post(`${API}/api/v1/memos`, {
    data: {
      categoryId: input.categoryId,
      confirmation: "CONFIRM_MONEY_MEMO",
      direction: input.direction ?? "expense",
      money: { amount: "10.00", currency: input.currency },
      moneySpaceId: input.moneySpaceId,
      note: input.note,
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

const emptyFilters = {
  categoryIds: [] as string[],
  currencies: [] as string[],
  directions: [] as string[],
  from: null as string | null,
  lifecycles: [] as string[],
  moneySpaceIds: [] as string[],
  planningStatuses: [] as string[],
  purposes: [] as string[],
  to: null as string | null,
};

async function search(
  request: APIRequestContext,
  cookie: string,
  input: {
    cursor?: string | null;
    filters?: typeof emptyFilters;
    limit?: number;
    query?: string | null;
  },
) {
  return request.post(`${API}/api/v1/memos/search`, {
    data: {
      cursor: input.cursor ?? null,
      filters: input.filters ?? emptyFilters,
      limit: input.limit ?? 50,
      query: input.query ?? null,
    },
    headers: { Cookie: cookie },
    failOnStatusCode: false,
  });
}

test.describe("US6 — Organize and privately find money activity", () => {
  test("authenticated browser manages starter/custom Categories and contextual Money Spaces", async ({
    page,
    request,
  }) => {
    const email = `us6-ui-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, email);
    await page.goto("/");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByTestId("onboarding-form")).toBeVisible();
    await page.getByTestId("privacy-ack").check();
    await page.getByRole("button", { name: "Complete onboarding" }).click();
    await expect(page.getByTestId("label-manager")).toBeVisible({ timeout: 10_000 });
    const labelManager = page.getByTestId("label-manager");
    await expect(labelManager.getByText("Food & Drink", { exact: true })).toBeVisible();
    await expect(labelManager.getByText("Personal", { exact: true })).toBeVisible();

    await page.getByLabel("Category name").fill("Acceptance organize");
    await page.getByRole("button", { name: "Create Category" }).click();
    const categoryRow = page
      .getByTestId(/^category-[0-9a-f]/u)
      .filter({ hasText: "Acceptance organize" });
    await expect(categoryRow).toBeVisible();
    await categoryRow.getByLabel("Rename Acceptance organize").fill("Acceptance renamed");
    await categoryRow.getByRole("button", { name: "Save name" }).click();
    const renamedCategory = page
      .getByTestId(/^category-[0-9a-f]/u)
      .filter({ hasText: "Acceptance renamed" });
    await renamedCategory.getByRole("button", { name: "Deactivate" }).click();
    await expect(renamedCategory).toContainText("inactive");
    await renamedCategory.getByRole("button", { name: "Restore" }).click();
    await expect(renamedCategory).toContainText("active");

    await page.getByLabel("Context name").fill("Acceptance project");
    await page.getByRole("button", { name: "Create Money Space" }).click();
    const spaceRow = page
      .getByTestId(/^money-space-[0-9a-f]/u)
      .filter({ hasText: "Acceptance project" });
    await expect(spaceRow).toBeVisible();
    await spaceRow.getByLabel("Rename Acceptance project").fill("Acceptance travel");
    await spaceRow.getByRole("button", { name: "Save name" }).click();
    await expect(
      page.getByTestId(/^money-space-[0-9a-f]/u).filter({ hasText: "Acceptance travel" }),
    ).toBeVisible();

    await page.getByLabel("Category name").fill("  ACCEPTANCE   RENAMED ");
    await page.getByRole("button", { name: "Create Category" }).click();
    await expect(page.getByTestId("labels-conflict")).toBeVisible();
    await expect(page.getByLabel("Category name")).toHaveValue("  ACCEPTANCE   RENAMED ");
    await expect(page.getByLabel(/balance/iu)).toHaveCount(0);
    await expect(page.getByLabel(/account number/iu)).toHaveCount(0);
  });

  test("POST search covers every filter, empty state, pagination, lifecycle, and RESULTS_CHANGED", async ({
    request,
  }) => {
    const email = `us6-search-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, email);
    const cookie = await login(request, email);
    await onboard(request, cookie);
    const category = await createCategory(request, cookie, "Acceptance filter category");
    const space = await createSpace(request, cookie, "Acceptance filter context");
    const memos: { id: string; revision: string }[] = [];
    for (let index = 0; index < 4; index += 1) {
      memos.push(
        await createMemo(request, cookie, {
          categoryId: category.id,
          currency: index === 1 ? "IDR" : "USD",
          moneySpaceId: space.id,
          note: `acceptance searchable ${String(index)}`,
          occurredAt: `2026-06-0${String(index + 1)}T10:00:00.000Z`,
          planningStatus: index === 2 ? "unplanned" : "planned",
          purpose: index === 3 ? "work" : "personal",
        }),
      );
    }
    const archivedMemo = memos.at(1);
    if (archivedMemo === undefined) throw new Error("Missing archive fixture");
    const archive = await request.post(`${API}/api/v1/memos/${archivedMemo.id}/archive`, {
      data: { expectedRevision: archivedMemo.revision },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(archive.status()).toBe(200);
    const deletedMemo = await createMemo(request, cookie, {
      categoryId: category.id,
      currency: "USD",
      moneySpaceId: space.id,
      note: "acceptance deleted only",
      occurredAt: "2026-06-05T10:00:00.000Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    const deleted = await request.post(`${API}/api/v1/memos/${deletedMemo.id}/recently-deleted`, {
      data: { expectedRevision: deletedMemo.revision },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(deleted.status()).toBe(200);

    const combined = await search(request, cookie, {
      filters: {
        categoryIds: [category.id],
        currencies: ["USD"],
        directions: ["expense"],
        from: "2026-06-01T00:00:00.000Z",
        lifecycles: ["active"],
        moneySpaceIds: [space.id],
        planningStatuses: ["planned"],
        purposes: ["personal"],
        to: "2026-06-05T00:00:00.000Z",
      },
      query: "acceptance searchable",
    });
    expect(combined.status()).toBe(200);
    const combinedBody = (await combined.json()) as { items: Record<string, unknown>[] };
    expect(combinedBody.items).toHaveLength(1);
    expect(combinedBody.items[0]).toMatchObject({
      categoryId: category.id,
      currencyCode: "USD",
      direction: "expense",
      moneySpaceId: space.id,
      planningStatus: "planned",
      purpose: "personal",
    });
    expect(combinedBody.items[0]).not.toHaveProperty("convertedAmount");

    const archived = await search(request, cookie, {
      filters: { ...emptyFilters, lifecycles: ["archived"] },
    });
    expect(((await archived.json()) as { items: unknown[] }).items).toHaveLength(1);
    const deletedSearch = await search(request, cookie, { query: "deleted only" });
    expect(((await deletedSearch.json()) as { items: unknown[] }).items).toEqual([]);
    const noMatch = await search(request, cookie, { query: "no_match_token" });
    expect(((await noMatch.json()) as { items: unknown[] }).items).toEqual([]);

    const first = await search(request, cookie, { limit: 1, query: "acceptance searchable" });
    const firstBody = (await first.json()) as { items: { id: string }[]; nextCursor: string };
    expect(firstBody.nextCursor).toBeTruthy();
    const second = await search(request, cookie, {
      cursor: firstBody.nextCursor,
      limit: 1,
      query: "acceptance searchable",
    });
    const secondBody = (await second.json()) as { items: { id: string }[] };
    expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);

    const renamed = await request.patch(`${API}/api/v1/categories/${category.id}`, {
      data: { expectedRevision: category.revision, name: "Acceptance invalidated category" },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(renamed.status()).toBe(200);
    const stale = await search(request, cookie, {
      cursor: firstBody.nextCursor,
      limit: 1,
      query: "acceptance searchable",
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toEqual({ messageCode: "RESULTS_CHANGED", restartRequired: true });
  });

  test("two users, foreign label IDs, private values, and detector errors disclose zero cross-account data", async ({
    request,
  }) => {
    const emailA = `us6-a-${Date.now()}@cashmemo.test`;
    const emailB = `us6-b-${Date.now()}@cashmemo.test`;
    await signupAndVerify(request, emailA);
    const cookieA = await login(request, emailA);
    await onboard(request, cookieA);
    await signupAndVerify(request, emailB);
    const cookieB = await login(request, emailB);
    await onboard(request, cookieB);
    const categoryA = await createCategory(request, cookieA, "Acceptance private A");
    const spaceA = await createSpace(request, cookieA, "Acceptance context A");
    await createMemo(request, cookieA, {
      categoryId: categoryA.id,
      currency: "USD",
      moneySpaceId: spaceA.id,
      note: "acceptance account a only",
      occurredAt: "2026-07-01T10:00:00.000Z",
      planningStatus: "planned",
      purpose: "personal",
    });
    const bSearch = await search(request, cookieB, { query: "account a only" });
    expect(((await bSearch.json()) as { items: unknown[] }).items).toEqual([]);
    const foreignFilter = await search(request, cookieB, {
      filters: { ...emptyFilters, categoryIds: [categoryA.id] },
    });
    expect(((await foreignFilter.json()) as { items: unknown[] }).items).toEqual([]);
    const foreignRename = await request.patch(`${API}/api/v1/categories/${categoryA.id}`, {
      data: { expectedRevision: categoryA.revision, name: "attempt" },
      headers: { Cookie: cookieB },
      failOnStatusCode: false,
    });
    expect(foreignRename.status()).toBe(404);
    expect(await foreignRename.text()).not.toContain("Acceptance private A");

    const candidate = "4111 1111 1111 1111";
    const blockedLabel = await request.post(`${API}/api/v1/categories`, {
      data: { kind: "expense", name: candidate },
      headers: { Cookie: cookieA, "Idempotency-Key": crypto.randomUUID() },
      failOnStatusCode: false,
    });
    expect(blockedLabel.status()).toBe(422);
    expect(await blockedLabel.text()).not.toContain(candidate);
    const blockedSearch = await search(request, cookieA, { query: candidate });
    expect(blockedSearch.status()).toBe(422);
    expect(await blockedSearch.text()).not.toContain(candidate);
    expect(blockedSearch.url()).not.toContain(candidate);
  });
});
