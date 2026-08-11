import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const execFileAsync = promisify(execFile);
const API = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const PASSWORD = "Acceptance-Password-1!";
const COMPOSE = "infra/containers/compose.yaml";

async function signupAndVerify(request: APIRequestContext, email: string): Promise<void> {
  expect(
    (
      await request.post(`${API}/api/v1/auth/sign-up`, {
        data: { email, idempotencyKey: crypto.randomUUID(), password: PASSWORD },
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

async function onboard(request: APIRequestContext, cookie: string, timezone = "UTC") {
  expect(
    (
      await request.put(`${API}/api/v1/me/onboarding`, {
        data: {
          defaultCurrency: "USD",
          locale: "en-US",
          privacyNoticeVersion: "1.0",
          reportingTimezone: timezone,
        },
        headers: { Cookie: cookie },
      })
    ).status(),
  ).toBe(200);
}

async function account(request: APIRequestContext, label: string) {
  const email = `us5-${label}-${Date.now()}-${crypto.randomUUID()}@cashmemo.test`;
  await signupAndVerify(request, email);
  const cookie = await login(request, email);
  await onboard(request, cookie);
  return { cookie, email };
}

function memoBody(note: string | null = null) {
  const occurredAt = new Date(Math.floor((Date.now() - 60_000) / 1_000) * 1_000).toISOString();
  return {
    categoryId: null,
    confirmation: "CONFIRM_MONEY_MEMO",
    direction: "expense",
    money: { amount: "12.50", currency: "USD" },
    moneySpaceId: null,
    note,
    occurrence: {
      occurredAt,
      occurredLocal: occurredAt.slice(0, 19),
      occurredOffsetMinutes: 0,
      occurredTimezone: "UTC",
      timezoneDatabaseVersion: "system-local",
    },
    planningStatus: "unplanned",
    purpose: "personal",
  };
}

async function createMemo(request: APIRequestContext, cookie: string, key = crypto.randomUUID()) {
  return request.post(`${API}/api/v1/memos`, {
    data: memoBody(),
    failOnStatusCode: false,
    headers: { Cookie: cookie, "x-idempotency-key": key },
  });
}

async function browserLogin(page: Page, email: string) {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("natural-language-capture")).toBeVisible({ timeout: 10_000 });
}

async function startVoice(request: APIRequestContext, cookie: string) {
  const response = await request.post(`${API}/api/v1/voice-captures`, {
    data: {
      aiConsent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION",
      captureStartedAt: new Date().toISOString(),
      captureTimezone: "UTC",
      detectorLimitationDisclosed: true,
      sttConsent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION",
    },
    headers: { Cookie: cookie, "Idempotency-Key": crypto.randomUUID() },
  });
  return (await response.json()) as { id: string };
}

async function uploadMarker(
  request: APIRequestContext,
  cookie: string,
  captureId: string,
  marker: number,
) {
  const bytes = Buffer.from([
    0x52,
    0x49,
    0x46,
    0x46,
    0x25,
    0x00,
    0x00,
    0x00,
    0x57,
    0x41,
    0x56,
    0x45,
    0x66,
    0x6d,
    0x74,
    0x20,
    0x10,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x40,
    0x1f,
    0x00,
    0x00,
    0x80,
    0x3e,
    0x00,
    0x00,
    0x02,
    0x00,
    0x10,
    0x00,
    0x64,
    0x61,
    0x74,
    0x61,
    0x01,
    0x00,
    0x00,
    0x00,
    marker,
  ]);
  return request.put(`${API}/api/v1/voice-captures/${captureId}/audio`, {
    data: bytes,
    failOnStatusCode: false,
    headers: {
      Cookie: cookie,
      "Content-Type": "audio/wav",
      "Idempotency-Key": crypto.randomUUID(),
    },
  });
}

test.describe("US5 — safe degraded operation", () => {
  test("accelerator, telemetry, reporting, and partial-result failures preserve manual authority", async ({
    request,
  }) => {
    const owner = await account(request, "accelerator-owner");
    const other = await account(request, "accelerator-other");
    const capabilities = (await (await request.get(`${API}/api/v1/capabilities`)).json()) as {
      manualJournal: string;
      telemetry: string;
    };
    expect(capabilities).toMatchObject({ manualJournal: "available", telemetry: "disabled" });

    expect((await createMemo(request, owner.cookie)).status()).toBe(201);
    const failedExtraction = await request.post(`${API}/api/v1/drafts/text-extraction`, {
      data: {
        captureStartedAt: new Date().toISOString(),
        captureTimezone: "UTC",
        consent: "SEND_THIS_TEXT_FOR_AI_EXTRACTION",
        text: "[scenario:unavailable] synthetic",
      },
      headers: { Cookie: owner.cookie },
    });
    const failedDraft = (await failedExtraction.json()) as {
      draft: { authoritative: boolean; id: string; status: string };
      state: string;
    };
    expect(failedDraft).toMatchObject({
      draft: { authoritative: false, status: "failed_recoverable" },
      state: "failed_recoverable",
    });
    expect(
      (
        await request.get(`${API}/api/v1/drafts/${failedDraft.draft.id}`, {
          failOnStatusCode: false,
          headers: { Cookie: other.cookie },
        })
      ).status(),
    ).toBe(404);

    const sttFailure = await startVoice(request, owner.cookie);
    expect(
      await (await uploadMarker(request, owner.cookie, sttFailure.id, 1)).json(),
    ).toMatchObject({
      authoritative: false,
      state: "failed_recoverable",
    });
    const incomplete = await startVoice(request, owner.cookie);
    expect(
      await (await uploadMarker(request, owner.cookie, incomplete.id, 3)).json(),
    ).toMatchObject({
      authoritative: false,
      state: "correction_required",
    });

    await onboard(request, owner.cookie, "Invalid/Reporting-Zone");
    expect(
      (
        await request.get(`${API}/api/v1/overview/current-month`, {
          failOnStatusCode: false,
          headers: { Cookie: owner.cookie },
        })
      ).status(),
    ).toBe(503);
    expect((await createMemo(request, owner.cookie)).status()).toBe(201);
    const history = (await (
      await request.get(`${API}/api/v1/memos`, { headers: { Cookie: owner.cookie } })
    ).json()) as { items: unknown[] };
    expect(history.items).toHaveLength(2);
  });

  test("browser offline failure and reload preserve an unconfirmed draft without false success", async ({
    page,
    request,
  }) => {
    const owner = await account(request, "browser-recovery");
    await browserLogin(page, owner.email);
    await page.getByLabel("Text to extract").fill("Synthetic recoverable draft");
    await page.getByLabel(/Send only this text/).check();
    await page.route("**/api/v1/drafts/text-extraction", async (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Review extracted draft" }).click();
    await expect(page.getByTestId("capability-assisted_capture_unavailable")).toBeVisible();
    await expect(page.getByLabel("Text to extract")).toHaveValue("Synthetic recoverable draft");
    expect(
      (
        (await (
          await request.get(`${API}/api/v1/memos`, { headers: { Cookie: owner.cookie } })
        ).json()) as { items: unknown[] }
      ).items,
    ).toHaveLength(0);

    await page.reload();
    await expect(page.getByLabel("Text to extract")).toHaveValue("Synthetic recoverable draft");
    expect(await page.evaluate(() => location.href)).not.toMatch(/Synthetic|recoverable|draft/iu);
    const durableDraftValues = await page.evaluate(async () => {
      const opened = indexedDB.open("cashmemo-recoverable-drafts", 1);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        opened.addEventListener(
          "success",
          () => {
            resolve(opened.result);
          },
          { once: true },
        );
        opened.addEventListener(
          "error",
          () => {
            reject(new Error("storage unavailable"));
          },
          { once: true },
        );
      });
      try {
        const request = database.transaction("drafts", "readonly").objectStore("drafts").getAll();
        return await new Promise<unknown[]>((resolve, reject) => {
          request.addEventListener(
            "success",
            () => {
              resolve(request.result);
            },
            { once: true },
          );
          request.addEventListener(
            "error",
            () => {
              reject(new Error("storage unavailable"));
            },
            { once: true },
          );
        });
      } finally {
        database.close();
      }
    });
    expect(JSON.stringify(durableDraftValues)).not.toMatch(/audio|blob|bytes/iu);
  });

  test("lost successful response retries same identity and creates one account-owned memo", async ({
    page,
    request,
  }) => {
    const owner = await account(request, "lost-response-owner");
    const other = await account(request, "lost-response-other");
    await browserLogin(page, owner.email);
    const key = crypto.randomUUID();
    let committedId: string | undefined;
    await page.route("**/api/v1/memos", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      committedId = ((await response.json()) as { id: string }).id;
      await route.abort("failed");
    });
    const outcome = await page.evaluate(
      async ({ body, idempotencyKey }) => {
        try {
          await fetch("/api/v1/memos", {
            body: JSON.stringify(body),
            headers: {
              "Content-Type": "application/json",
              "x-idempotency-key": idempotencyKey,
            },
            method: "POST",
          });
          return "unexpected-success";
        } catch {
          return "uncertain";
        }
      },
      { body: memoBody(), idempotencyKey: key },
    );
    expect(outcome).toBe("uncertain");
    expect(committedId).toBeDefined();
    const retry = await createMemo(request, owner.cookie, key);
    expect((await retry.json()) as { id: string }).toMatchObject({ id: committedId });
    const ownerHistory = (await (
      await request.get(`${API}/api/v1/memos`, { headers: { Cookie: owner.cookie } })
    ).json()) as { items: { id: string }[] };
    expect(ownerHistory.items).toHaveLength(1);
    expect(ownerHistory.items[0]?.id).toBe(committedId);
    expect(
      (
        (await (
          await request.get(`${API}/api/v1/memos`, { headers: { Cookie: other.cookie } })
        ).json()) as { items: unknown[] }
      ).items,
    ).toHaveLength(0);
  });

  test("database outage and revoked authentication fail closed, then explicit recovery saves", async ({
    request,
  }) => {
    const owner = await account(request, "core-outage");
    const before = await createMemo(request, owner.cookie);
    expect(before.status()).toBe(201);

    try {
      await execFileAsync("docker", ["compose", "-f", COMPOSE, "stop", "postgres"]);
      const blocked = await createMemo(request, owner.cookie);
      expect(blocked.status()).not.toBe(201);
    } finally {
      await execFileAsync("docker", ["compose", "-f", COMPOSE, "start", "postgres"]);
    }
    await expect
      .poll(
        async () =>
          (
            await request.get(`${API}/api/v1/auth/session`, {
              failOnStatusCode: false,
              headers: { Cookie: owner.cookie },
            })
          ).status(),
        { timeout: 30_000 },
      )
      .toBe(200);
    const afterRecovery = await createMemo(request, owner.cookie);
    expect(afterRecovery.status()).toBe(201);
    const history = (await (
      await request.get(`${API}/api/v1/memos`, { headers: { Cookie: owner.cookie } })
    ).json()) as { items: unknown[] };
    expect(history.items).toHaveLength(2);

    expect(
      (
        await request.post(`${API}/api/v1/auth/logout`, {
          headers: { Cookie: owner.cookie },
        })
      ).status(),
    ).toBe(204);
    const denied = await createMemo(request, owner.cookie);
    expect(denied.status()).toBe(401);
  });
});
