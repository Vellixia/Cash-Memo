import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

type CanaryCorpus = Readonly<{
  entries: ReadonlyArray<Readonly<{ raw: string }>>;
}>;
type TestSession = Readonly<{ userId: string; sessionSecret: string }>;

const endpoint = requiredEnvironment("APPWRITE_ENDPOINT").replace(/\/$/u, "");
const projectId = requiredEnvironment("APPWRITE_PROJECT_ID");
const serverKey = requiredEnvironment("APPWRITE_SERVER_API_KEY");
const captureDirectory = resolve(
  requiredEnvironment("CASHMEMO_PRIVACY_CAPTURE_DIR"),
);
const corpus = JSON.parse(
  await readFile(resolve("tests/privacy/fixtures/canaries.json"), "utf8"),
) as CanaryCorpus;

test("real US1 boundaries emit no private candidate diagnostics", async ({
  context,
  page,
  request,
}) => {
  await mkdir(captureDirectory, { recursive: true });
  const session = await createSession(request);
  const browserCapture: Array<Record<string, string>> = [];
  page.on("console", (event) => {
    browserCapture.push({ channel: "console", type: event.type() });
  });
  page.on("pageerror", (error) => {
    browserCapture.push({ channel: "pageerror", name: error.name });
  });
  page.on("requestfailed", (failed) => {
    browserCapture.push({
      channel: "requestfailed",
      method: failed.method(),
    });
  });

  try {
    await authenticate(context, session.sessionSecret);
    await page.goto("/money-memos/new");
    await expect(
      page.getByRole("heading", { name: "Create Money Memo" }),
    ).toBeVisible();

    const categoryId = await page.getByLabel("Category").inputValue();
    const moneySpaceId = await page.getByLabel("Money Space").inputValue();

    await page.getByLabel("Amount").fill("9273.41");
    await page
      .getByLabel("Note (optional)")
      .fill("CM_CANARY_NOTE_copper-orchid-731");
    await page.getByRole("button", { name: "Save Money Memo" }).click();
    await expect(
      page.getByRole("heading", { name: "Money Memo saved" }),
    ).toBeVisible();

    const rejected = await page.evaluate(
      async ({ categoryId, moneySpaceId, note }) => {
        const response = await fetch("/api/v1/money-memos", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creationId: crypto.randomUUID(),
            type: "expense",
            amount: "42.50",
            currency: "USD",
            occurrence: {
              instant: "2026-08-01T00:00:00.000000Z",
              localWallTime: "2026-08-01T07:00:00.000000",
              utcOffset: "+07:00",
            },
            categoryId,
            moneySpaceId,
            note,
            plannedStatus: "unplanned",
            purpose: "personal",
          }),
        });
        return { status: response.status, body: await response.json() };
      },
      {
        categoryId,
        moneySpaceId,
        note: corpus.entries.map((entry) => entry.raw).join(" "),
      },
    );
    expect(rejected.status).toBe(422);
    expect(rejected.body).toMatchObject({
      code: "PRIVACY_INPUT_REJECTED",
      fieldErrors: [{ detectorId: "B1_PAN_LUHN" }],
    });
    const encodedError = JSON.stringify(rejected.body);
    for (const entry of corpus.entries)
      expect(encodedError).not.toContain(entry.raw);

    await writeFile(
      resolve(captureDirectory, "http-error.json"),
      `${JSON.stringify(rejected.body)}\n`,
      { mode: 0o600 },
    );

    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("cashmemo synthetic browser crash");
      }, 0);
    });
    await expect
      .poll(() => browserCapture.some((entry) => entry.channel === "pageerror"))
      .toBe(true);
  } finally {
    await writeFile(
      resolve(captureDirectory, "browser.json"),
      `${JSON.stringify(browserCapture)}\n`,
      { mode: 0o600 },
    );
    await deleteUser(request, session.userId);
  }
});

async function createSession(request: APIRequestContext): Promise<TestSession> {
  const userId = `privacy${randomUUID().replaceAll("-", "")}`;
  const password = `T9-${randomUUID().replaceAll("-", "")}`;
  const created = await request.post(`${endpoint}/users`, {
    headers: serverHeaders(),
    data: {
      userId,
      email: `${userId}@cashmemo.test`,
      password,
      name: "Privacy Gate User",
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
