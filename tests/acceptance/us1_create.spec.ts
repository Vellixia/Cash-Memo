import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

type TestSession = Readonly<{
  userId: string;
  sessionSecret: string;
}>;

const endpoint = requiredEnvironment("APPWRITE_ENDPOINT").replace(/\/$/u, "");
const projectId = requiredEnvironment("APPWRITE_PROJECT_ID");
const serverKey = requiredEnvironment("APPWRITE_SERVER_API_KEY");

test.describe("US1 real authenticated production journey", () => {
  let session: TestSession;

  test.beforeEach(async ({ context, request }) => {
    session = await createSession(request);
    await authenticate(context, session.sessionSecret);
  });

  test.afterEach(async ({ request }) => {
    await deleteUser(request, session.userId);
  });

  test("validates, preserves warning input, and persists one exact memo", async ({
    page,
  }) => {
    let createCount = 0;
    let submittedCreationId = "";
    const createStatuses: number[] = [];
    const pageErrors: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v1/money-memos")
      ) {
        createCount += 1;
        const value = request.postDataJSON() as { creationId?: unknown };
        if (typeof value.creationId === "string")
          submittedCreationId = value.creationId;
      }
    });
    page.on("response", (response) => {
      if (
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v1/money-memos")
      ) {
        createStatuses.push(response.status());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openCompose(page);
    await expect.poll(() => composeDraftCount(page)).toBe(1);
    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect(
      page.getByRole("alert", { name: "Correct these fields" }),
    ).toContainText("positive amount");
    expect(createCount).toBe(0);

    await page.getByLabel("Amount").fill("42.50");
    await page
      .getByLabel("Note (optional)")
      .fill("Discuss bank account policy");
    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect(
      page.getByRole("button", { name: "Continue unchanged" }),
    ).toBeVisible();
    await expect(page.getByLabel("Note (optional)")).toHaveValue(
      "Discuss bank account policy",
    );
    expect(createCount).toBe(0);

    await page.getByRole("button", { name: "Continue unchanged" }).click();
    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect.poll(() => createStatuses).toEqual([201]);
    expect(pageErrors).toEqual([]);
    await expect
      .poll(() => composeContainsCreation(page, submittedCreationId))
      .toBe(false);
    await expect.poll(() => composeDraftCount(page)).toBe(0);
    await expect(
      page.getByRole("heading", { name: "Money Memo saved" }),
    ).toBeVisible();
    expect(createCount).toBe(1);
  });

  test("browser reopen restores draft and stable creation identifier", async ({
    page,
  }) => {
    const creationIds: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "POST" ||
        !request.url().endsWith("/api/v1/money-memos")
      )
        return;
      const value = request.postDataJSON() as { creationId?: unknown };
      if (typeof value.creationId === "string")
        creationIds.push(value.creationId);
    });

    await openCompose(page);
    await page.getByLabel("Amount").fill("73.25");
    await expect(page.getByLabel("Amount")).toHaveValue("73.25");
    await page.reload();
    await expect(page.getByLabel("Amount")).toHaveValue("73.25");

    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect(
      page.getByRole("heading", { name: "Money Memo saved" }),
    ).toBeVisible();
    expect(creationIds).toHaveLength(1);
    expect(creationIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  test("lost create response retains draft and same-ID retry returns existing memo", async ({
    page,
  }) => {
    const creationIds: string[] = [];
    let attempt = 0;
    await page.route("**/api/v1/money-memos", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      const value = request.postDataJSON() as { creationId?: unknown };
      if (typeof value.creationId === "string")
        creationIds.push(value.creationId);
      attempt += 1;
      if (attempt === 1) {
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(201);
        await route.abort("failed");
        return;
      }
      const existing = await route.fetch();
      expect(existing.status()).toBe(200);
      await route.fulfill({ response: existing });
    });

    await openCompose(page);
    await page.getByLabel("Amount").fill("81.75");
    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect(page.getByRole("status")).toContainText("not saved");
    await expect(page.getByLabel("Amount")).toHaveValue("81.75");

    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect(
      page.getByRole("heading", { name: "Money Memo saved" }),
    ).toBeVisible();
    expect(creationIds).toHaveLength(2);
    expect(creationIds[1]).toBe(creationIds[0]);
  });

  test("blocking finding preserves input and sends no mutation", async ({
    page,
  }) => {
    let createCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v1/money-memos")
      ) {
        createCount += 1;
      }
    });
    await openCompose(page);
    await page.getByLabel("Amount").fill("42.50");
    await page.getByLabel("Note (optional)").fill("4111111111111111");
    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect(page.getByText(/cannot be submitted/i)).toBeVisible();
    await expect(page.getByLabel("Note (optional)")).toHaveValue(
      "4111111111111111",
    );
    expect(createCount).toBe(0);
  });
});

async function openCompose(page: Page): Promise<void> {
  await page.goto("/money-memos/new");
  await expect(
    page.getByRole("heading", { name: "Create Money Memo" }),
  ).toBeVisible();
  await expect(page.getByText(/Do not enter bank credentials/i)).toBeVisible();
  await expect(page.getByLabel("Category")).toHaveValue(/.+/u);
  await expect(page.getByLabel("Money Space")).toHaveValue(/.+/u);
}

async function createSession(request: APIRequestContext): Promise<TestSession> {
  const userId = `pw${randomUUID().replaceAll("-", "")}`;
  const password = `T9-${randomUUID().replaceAll("-", "")}`;
  const created = await request.post(`${endpoint}/users`, {
    headers: serverHeaders(),
    data: {
      userId,
      email: `${userId}@cashmemo.test`,
      password,
      name: "Production Journey User",
    },
  });
  expect(created.status()).toBe(201);
  const response = await request.post(`${endpoint}/users/${userId}/sessions`, {
    headers: serverHeaders(),
    data: {},
  });
  expect(response.status()).toBe(201);
  const value = (await response.json()) as { secret?: unknown };
  if (typeof value.secret !== "string" || value.secret.length === 0) {
    throw new Error("Appwrite session secret unavailable");
  }
  return { userId, sessionSecret: value.secret };
}

async function authenticate(
  context: BrowserContext,
  sessionSecret: string,
): Promise<void> {
  await context.addCookies([
    {
      name: "cashmemo_session",
      value: sessionSecret,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}

async function deleteUser(
  request: APIRequestContext,
  userId: string,
): Promise<void> {
  const response = await request.delete(`${endpoint}/users/${userId}`, {
    headers: serverHeaders(),
  });
  expect([204, 404]).toContain(response.status());
}

function serverHeaders(): Record<string, string> {
  return {
    "X-Appwrite-Project": projectId,
    "X-Appwrite-Key": serverKey,
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} required`);
  return value;
}

async function composeDraftCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("cashmemo_local");
        open.onerror = () => reject(new Error("compose database unavailable"));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("composeDrafts", "readonly");
          const count = transaction.objectStore("composeDrafts").count();
          count.onerror = () => reject(new Error("compose count unavailable"));
          count.onsuccess = () => {
            database.close();
            resolve(count.result);
          };
        };
      }),
  );
}

async function composeContainsCreation(
  page: Page,
  creationId: string,
): Promise<boolean> {
  return page.evaluate(
    ({ expected }) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open("cashmemo_local");
        open.onerror = () => reject(new Error("compose database unavailable"));
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction("composeDrafts", "readonly");
          const rows = transaction.objectStore("composeDrafts").getAll();
          rows.onerror = () => reject(new Error("compose read unavailable"));
          rows.onsuccess = () => {
            database.close();
            resolve(
              rows.result.some(
                (row) =>
                  typeof row === "object" &&
                  row !== null &&
                  "creationId" in row &&
                  row.creationId === expected,
              ),
            );
          };
        };
      }),
    { expected: creationId },
  );
}
