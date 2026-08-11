/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-useless-constructor, @typescript-eslint/require-await */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const PASSWORD = "Acceptance-Password-1!";
const WAV = Buffer.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE"), 0]);

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

async function onboard(request: APIRequestContext, cookie: string): Promise<void> {
  expect(
    (
      await request.put(`${API}/api/v1/me/onboarding`, {
        data: {
          defaultCurrency: "USD",
          locale: "en-US",
          privacyNoticeVersion: "1.0",
          reportingTimezone: "UTC",
        },
        headers: { Cookie: cookie },
      })
    ).status(),
  ).toBe(200);
}

async function account(request: APIRequestContext, suffix: string) {
  const email = `us3-${suffix}-${Date.now()}-${crypto.randomUUID()}@cashmemo.test`;
  await signupAndVerify(request, email);
  const cookie = await login(request, email);
  await onboard(request, cookie);
  return { cookie, email };
}

async function browserLogin(page: Page, email: string) {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("natural-language-capture")).toBeVisible({ timeout: 10_000 });
}

async function installSyntheticMicrophone(page: Page, accelerateLimit = false) {
  await page.addInitScript((accelerate) => {
    const track = { addEventListener: () => undefined, stop: () => undefined };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });
    class SyntheticRecorder {
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      state: RecordingState = "inactive";
      constructor(_stream: unknown, _options: unknown) {}
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0])], { type: "audio/webm" }),
        });
        this.onstop?.();
      }
    }
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: SyntheticRecorder,
    });
    if (accelerate) {
      const native = globalThis.setInterval;
      globalThis.setInterval = ((callback: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 1000) {
          for (let index = 0; index < 60; index += 1)
            queueMicrotask(() => {
              if (typeof callback === "function") callback(...args);
            });
          return 1;
        }
        return native(callback, timeout, ...args);
      }) as typeof setInterval;
    }
  }, accelerateLimit);
}

test.describe("US3 — reviewed assisted capture", () => {
  test("typed browser flow requires consent, review, correction, and one explicit confirmation", async ({
    page,
    request,
  }) => {
    const owner = await account(request, "typed");
    await browserLogin(page, owner.email);
    const submit = page.getByRole("button", { name: "Review extracted draft" });
    await page.getByLabel("Text to extract").fill("Synthetic reviewed expense");
    await expect(submit).toBeDisabled();
    await page.getByLabel(/Send only this text/).check();
    await submit.click();
    await expect(page.getByTestId("assisted-draft-review")).toBeVisible();
    await expect(page.getByTestId("draft-not-authoritative")).toContainText("not financial truth");

    const occurredAt = new Date(Math.floor((Date.now() - 60_000) / 1_000) * 1_000).toISOString();
    await page.locator("#draft-occurredAt").fill(occurredAt);
    await page.locator("#draft-occurredLocal").fill(occurredAt.slice(0, 19));
    await page.locator("#draft-occurredTimezone").fill("UTC");
    await page.locator("#draft-occurredOffsetMinutes").fill("0");
    await page.locator("#draft-timezoneDatabaseVersion").fill("system-local");
    await page.getByRole("button", { name: "Confirm Money Memo" }).click();
    await expect(page.getByTestId("assisted-confirmed")).toBeVisible();
    const memos = (await (
      await request.get(`${API}/api/v1/memos`, { headers: { Cookie: owner.cookie } })
    ).json()) as { items: unknown[] };
    expect(memos.items).toHaveLength(1);
    expect(page.url()).not.toMatch(/Synthetic|12\.50|amount|currency/iu);
  });

  test("voice browser/HTTP flow is reviewed, idempotent, failure-safe, and account-isolated", async ({
    page,
    request,
  }) => {
    const owner = await account(request, "voice-owner");
    const other = await account(request, "voice-other");
    await installSyntheticMicrophone(page);
    await browserLogin(page, owner.email);
    await expect(page.getByTestId("voice-detector-limitation")).toContainText(
      "before text privacy detection",
    );
    await page.getByLabel(/Send only this recording/).check();
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByRole("button", { name: "Stop and review recording" }).click();
    const uploadResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/voice-captures/") && response.url().endsWith("/audio"),
    );
    await page.getByRole("button", { name: "Send this recording" }).click();
    const firstBody = (await (await uploadResponse).json()) as {
      draftId: string;
      id: string;
      state: string;
    };
    expect(firstBody.state).toBe("draft_review");
    const capture = { id: firstBody.id };
    const currentDraft = (await (
      await request.get(`${API}/api/v1/drafts/${firstBody.draftId}`, {
        headers: { Cookie: owner.cookie },
      })
    ).json()) as { revision: string };
    const occurredAt = new Date(Math.floor((Date.now() - 60_000) / 1_000) * 1_000).toISOString();
    const edited = await request.patch(`${API}/api/v1/drafts/${firstBody.draftId}`, {
      data: {
        candidateFields: { amount: "14.25", currency: "USD", direction: "expense" },
        expectedRevision: currentDraft.revision,
        sourceCompleteness: "complete",
        sourceText: "synthetic complete transcript",
      },
      headers: { Cookie: owner.cookie },
    });
    const editedDraft = (await edited.json()) as { revision: string };
    const confirmation = {
      confirmation: "CONFIRM_MONEY_MEMO",
      expectedRevision: editedDraft.revision,
      memo: {
        categoryId: null,
        direction: "expense",
        money: { amount: "14.25", currency: "USD" },
        moneySpaceId: null,
        note: null,
        occurrence: {
          occurredAt,
          occurredLocal: occurredAt.slice(0, 19),
          occurredOffsetMinutes: 0,
          occurredTimezone: "UTC",
          timezoneDatabaseVersion: "system-local",
        },
        planningStatus: "unplanned",
        purpose: "personal",
      },
    };
    const confirmKey = crypto.randomUUID();
    const firstConfirm = await request.post(`${API}/api/v1/drafts/${firstBody.draftId}/confirm`, {
      data: confirmation,
      headers: { Cookie: owner.cookie, "Idempotency-Key": confirmKey },
    });
    const secondConfirm = await request.post(`${API}/api/v1/drafts/${firstBody.draftId}/confirm`, {
      data: confirmation,
      headers: { Cookie: owner.cookie, "Idempotency-Key": confirmKey },
    });
    expect(firstConfirm.status()).toBe(201);
    expect(await secondConfirm.json()).toEqual(await firstConfirm.json());
    expect(
      (
        await request.get(`${API}/api/v1/voice-captures/${capture.id}`, {
          headers: { Cookie: other.cookie },
          failOnStatusCode: false,
        })
      ).status(),
    ).toBe(404);

    for (const [marker, expected] of [
      [3, "correction_required"],
      [1, "failed_recoverable"],
    ] as const) {
      const started = await request.post(`${API}/api/v1/voice-captures`, {
        data: {
          aiConsent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION",
          captureStartedAt: new Date().toISOString(),
          captureTimezone: "UTC",
          detectorLimitationDisclosed: true,
          sttConsent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION",
        },
        headers: { Cookie: owner.cookie, "Idempotency-Key": crypto.randomUUID() },
      });
      const item = (await started.json()) as { id: string };
      const bytes = Buffer.from(WAV);
      bytes[bytes.length - 1] = marker;
      const result = await request.put(`${API}/api/v1/voice-captures/${item.id}/audio`, {
        data: bytes,
        headers: {
          Cookie: owner.cookie,
          "Content-Type": "audio/wav",
          "Idempotency-Key": crypto.randomUUID(),
        },
      });
      expect((await result.json()) as { state: string }).toMatchObject({ state: expected });
    }
    const memos = (await (
      await request.get(`${API}/api/v1/memos`, { headers: { Cookie: owner.cookie } })
    ).json()) as { items: unknown[] };
    expect(memos.items).toHaveLength(1);
    const otherMemos = (await (
      await request.get(`${API}/api/v1/memos`, { headers: { Cookie: other.cookie } })
    ).json()) as { items: unknown[] };
    expect(otherMemos.items).toHaveLength(0);
  });

  test("voice 60-second auto-stop retains current recording for normal flow", async ({
    page,
    request,
  }) => {
    const owner = await account(request, "voice-limit");
    await installSyntheticMicrophone(page, true);
    await browserLogin(page, owner.email);
    await page.getByLabel(/Send only this recording/).check();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByTestId("recording-limit-reached")).toContainText("retained for review");
    await expect(page.getByRole("button", { name: "Send this recording" })).toBeEnabled();
  });

  test("privacy rejection occurs before provider/persistence and recovery stays available", async ({
    page,
    request,
  }) => {
    const owner = await account(request, "privacy");
    const blocked = await request.post(`${API}/api/v1/drafts/text-extraction`, {
      data: {
        captureStartedAt: new Date().toISOString(),
        captureTimezone: "UTC",
        consent: "SEND_THIS_TEXT_FOR_AI_EXTRACTION",
        text: "CVV: 123",
      },
      headers: { Cookie: owner.cookie },
      failOnStatusCode: false,
    });
    expect(blocked.status()).toBe(422);
    expect(blocked.headers()["cache-control"]).toBe("private, no-store, max-age=0");
    await browserLogin(page, owner.email);
    await page.getByLabel("Text to extract").fill("CVV: 123");
    await page.getByLabel(/Send only this text/).check();
    await page.getByRole("button", { name: "Review extracted draft" }).click();
    await expect(page.getByRole("alert")).toContainText("cannot be sent");
    await expect(page.getByLabel("Text to extract")).toHaveValue("CVV: 123");
    await expect(page.getByText(/Do not enter card numbers/)).toBeVisible();
    expect(page.url()).not.toMatch(/CVV|123|text=/u);
  });
});
