import { expect, test, type Page } from "@playwright/test";

type CreateRequest = {
  creationId: string;
  type: "income" | "expense";
  amount: string;
  currency: string;
  occurrence: {
    instant: string;
    localWallTime: string;
    utcOffset: string;
  };
  categoryId: string;
  moneySpaceId: string;
  note: string | null;
  plannedStatus: "planned" | "unplanned";
  purpose: "personal" | "work" | "mixed";
};

const categoryId = "66ff6d25-01b0-4442-a9fe-0c4fef1f0605";
const moneySpaceId = "9074bd6a-6959-463a-8a04-88a537d12d57";

async function mockReferences(page: Page) {
  await page.route("**/api/v1/reference/currencies", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "iso4217-list-one-2026-01-01",
        sourceEffectiveDate: "2026-01-01",
        currencies: [{ code: "USD", minorUnitScale: 2 }],
      }),
    }),
  );
  await page.route("**/api/v1/labels/query", async (route) => {
    const request = route.request().postDataJSON() as { kind: string };
    const category = request.kind === "category";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: category ? categoryId : moneySpaceId,
            kind: category ? "category" : "money_space",
            name: category ? "General" : "Personal",
            state: "active",
            revision: 1,
            createdAt: "2026-01-01T00:00:00.000000Z",
            updatedAt: "2026-01-01T00:00:00.000000Z",
          },
        ],
      }),
    });
  });
}

function memoResponse(request: CreateRequest) {
  return {
    id: "f5b77e8f-ae9a-466e-8df4-b0079825f46e",
    type: request.type,
    amount: request.amount,
    currency: request.currency,
    amountMinorUnitScale: 2,
    occurrence: request.occurrence,
    category: { id: categoryId, name: "General", state: "active" },
    moneySpace: {
      id: moneySpaceId,
      name: "Personal",
      state: "active",
    },
    note: request.note,
    plannedStatus: request.plannedStatus,
    purpose: request.purpose,
    lifecycleStatus: "active",
    purgeDeadline: null,
    revision: 1,
    createdAt: "2026-08-01T00:00:00.000000Z",
    updatedAt: "2026-08-01T00:00:00.000000Z",
  };
}

test("US1 validates, corrects a warning, and creates one exact memo", async ({
  page,
}) => {
  await mockReferences(page);
  const requests: CreateRequest[] = [];
  await page.route("**/api/v1/money-memos", async (route) => {
    const request = route.request().postDataJSON() as CreateRequest;
    requests.push(request);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(memoResponse(request)),
    });
  });

  await page.goto("/money-memos/new");
  await expect(
    page.getByRole("heading", { name: "Create Money Memo" }),
  ).toBeVisible();
  await expect(page.getByText(/Do not enter bank credentials/i)).toBeVisible();

  await page.getByRole("button", { name: "Save Money Memo" }).click();
  await expect(
    page.getByRole("alert", { name: "Correct these fields" }),
  ).toContainText("positive amount");
  expect(requests).toHaveLength(0);

  await page.getByLabel("Amount").fill("42.50");
  await page.getByLabel("Note (optional)").fill("Discuss bank account policy");
  await page.getByRole("button", { name: "Save Money Memo" }).click();
  await expect(
    page.getByRole("button", { name: "Continue unchanged" }),
  ).toBeVisible();
  await expect(page.getByLabel("Note (optional)")).toHaveValue(
    "Discuss bank account policy",
  );
  expect(requests).toHaveLength(0);

  await page.getByRole("button", { name: "Continue unchanged" }).click();
  await page.getByRole("button", { name: "Save Money Memo" }).click();
  await expect(
    page.getByRole("heading", { name: "Money Memo saved" }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.creationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(requests[0]?.amount).toBe("42.50");
  expect(requests[0]?.categoryId).toBe(categoryId);
  expect(requests[0]?.moneySpaceId).toBe(moneySpaceId);
});

test("US1 retry preserves draft and reuses creation identifier", async ({
  page,
}) => {
  await mockReferences(page);
  const requests: CreateRequest[] = [];
  await page.route("**/api/v1/money-memos", async (route) => {
    const request = route.request().postDataJSON() as CreateRequest;
    requests.push(request);
    if (requests.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Money Memo service temporarily unavailable.",
          requestId: "2e252b21-f068-468a-9099-5ed22e125fb8",
          retryable: true,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(memoResponse(request)),
    });
  });

  await page.goto("/money-memos/new");
  await page.getByLabel("Amount").fill("42.50");
  await page.getByRole("button", { name: "Save Money Memo" }).click();
  await expect(page.getByRole("status")).toContainText(
    "temporarily unavailable",
  );
  await expect(page.getByLabel("Amount")).toHaveValue("42.50");

  await page.getByRole("button", { name: "Save Money Memo" }).click();
  await expect(
    page.getByRole("heading", { name: "Money Memo saved" }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]?.creationId).toBe(requests[0]?.creationId);
});

test("US1 blocking finding preserves input and sends no request", async ({
  page,
}) => {
  await mockReferences(page);
  let requestCount = 0;
  await page.route("**/api/v1/money-memos", async (route) => {
    requestCount += 1;
    await route.abort();
  });

  await page.goto("/money-memos/new");
  await page.getByLabel("Amount").fill("42.50");
  await page.getByLabel("Note (optional)").fill("4111111111111111");
  await page.getByRole("button", { name: "Save Money Memo" }).click();
  await expect(page.getByText(/cannot be submitted/i)).toBeVisible();
  await expect(page.getByLabel("Note (optional)")).toHaveValue(
    "4111111111111111",
  );
  expect(requestCount).toBe(0);
});
