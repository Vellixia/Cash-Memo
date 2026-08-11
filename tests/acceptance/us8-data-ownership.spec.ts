import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const PASSWORD = "Acceptance-Password-1!";

async function signupAndVerify(request: APIRequestContext, label: string) {
  const email = `us8-${label}-${Date.now()}-${crypto.randomUUID()}@cashmemo.test`;
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
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const cookie = login.headers()["set-cookie"]?.split(";")[0] ?? "";
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
  return { cookie, email };
}

async function browserLogin(page: Page, email: string) {
  await page.goto("/");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByTestId("export-center")).toBeVisible({ timeout: 10_000 });
}

async function reauth(
  request: APIRequestContext,
  cookie: string,
  scope: "account_delete" | "export" | "purge",
) {
  const response = await request.post(`${API}/api/v1/auth/reauth`, {
    data: { password: PASSWORD, scope: [scope] },
    headers: { Cookie: cookie },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { grantId: string }).grantId;
}

function memoBody(note: string) {
  return {
    categoryId: null,
    confirmation: "CONFIRM_MONEY_MEMO",
    direction: "expense",
    money: { amount: "12.50", currency: "USD" },
    moneySpaceId: null,
    note,
    occurrence: {
      occurredAt: "2026-08-11T00:00:00.000Z",
      occurredLocal: "2026-08-11T00:00:00",
      occurredOffsetMinutes: 0,
      occurredTimezone: "UTC",
      timezoneDatabaseVersion: "system-local",
    },
    planningStatus: "unplanned",
    purpose: "personal",
  };
}

async function createMemo(request: APIRequestContext, cookie: string, note: string) {
  const response = await request.post(`${API}/api/v1/memos`, {
    data: memoBody(note),
    headers: { Cookie: cookie, "x-idempotency-key": crypto.randomUUID() },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; revision: string };
}

async function requestExport(request: APIRequestContext, cookie: string) {
  const grant = await reauth(request, cookie, "export");
  const response = await request.post(`${API}/api/v1/exports`, {
    data: { includeRecoverableDrafts: false, schemaVersion: "1.0" },
    headers: {
      Cookie: cookie,
      "Idempotency-Key": crypto.randomUUID(),
      "x-reauth-grant": grant,
    },
  });
  expect(response.status()).toBe(202);
  return (await response.json()) as { id: string; revision: string; state: string };
}

async function exportStatus(request: APIRequestContext, cookie: string, id: string) {
  const response = await request.get(`${API}/api/v1/exports/${id}`, {
    failOnStatusCode: false,
    headers: { Cookie: cookie },
  });
  return { body: (await response.json()) as Record<string, unknown>, status: response.status() };
}

test.describe("US8 — export and deletion lifecycle", () => {
  test("browser requests deterministic private export; download, expiry, cancel, and isolation hold", async ({
    page,
    request,
  }) => {
    const owner = await signupAndVerify(request, "export-owner");
    const other = await signupAndVerify(request, "export-other");
    await createMemo(request, owner.cookie, "=SYNTHETIC-FORMULA-CANARY");
    await browserLogin(page, owner.email);
    await page.getByTestId("export-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Request export" }).click();
    await expect(page.getByText("Available", { exact: true })).toBeVisible({ timeout: 10_000 });

    const jobs = (await (
      await request.get(`${API}/api/v1/exports`, { headers: { Cookie: owner.cookie } })
    ).json()) as { id: string; expiresAt: string; state: string }[];
    const ready = jobs.find((job) => job.state === "ready");
    expect(ready).toBeDefined();
    if (ready === undefined) throw new Error("READY_EXPORT_MISSING");
    expect((await exportStatus(request, other.cookie, ready.id)).status).toBe(404);

    const downloadGrant = await reauth(request, owner.cookie, "export");
    const download = await request.post(`${API}/api/v1/exports/${ready.id}/download`, {
      headers: { Cookie: owner.cookie, "x-reauth-grant": downloadGrant },
    });
    expect(download.status()).toBe(200);
    expect((await download.body()).subarray(0, 2).toString("utf8")).toBe("PK");
    expect(download.headers()["content-disposition"]).not.toMatch(/s3|bucket|https?:/iu);

    expect(
      (
        await request.post(`${API}/api/v1/test-support/exports/expire`, {
          data: { now: new Date(Date.parse(ready.expiresAt) + 1).toISOString() },
          headers: { Cookie: owner.cookie },
        })
      ).status(),
    ).toBe(200);
    const expiredGrant = await reauth(request, owner.cookie, "export");
    expect(
      (
        await request.post(`${API}/api/v1/exports/${ready.id}/download`, {
          failOnStatusCode: false,
          headers: { Cookie: owner.cookie, "x-reauth-grant": expiredGrant },
        })
      ).status(),
    ).toBe(409);

    const cancelTarget = await requestExport(request, owner.cookie);
    await expect
      .poll(async () => (await exportStatus(request, owner.cookie, cancelTarget.id)).body["state"])
      .toBe("ready");
    const current = await exportStatus(request, owner.cookie, cancelTarget.id);
    const cancelGrant = await reauth(request, owner.cookie, "export");
    const canceled = await request.delete(`${API}/api/v1/exports/${cancelTarget.id}`, {
      data: { expectedRevision: current.body["revision"] },
      headers: { Cookie: owner.cookie, "x-reauth-grant": cancelGrant },
    });
    expect((await canceled.json()) as Record<string, unknown>).toMatchObject({ state: "canceled" });
    expect(await page.evaluate(() => location.href)).not.toMatch(/SYNTHETIC|12\.50|exportId/iu);
  });

  test("record lifecycle restores, then suppresses before purge; suppression failure stays inaccessible", async ({
    request,
  }) => {
    const owner = await signupAndVerify(request, "memo-purge");
    const memo = await createMemo(request, owner.cookie, "DELETE-CANARY-NOT-IN-DIAGNOSTICS");
    const deleted = await request.post(`${API}/api/v1/memos/${memo.id}/recently-deleted`, {
      data: { expectedRevision: memo.revision },
      headers: { Cookie: owner.cookie },
    });
    const deletedBody = (await deleted.json()) as { revision: string };
    const restored = await request.delete(`${API}/api/v1/memos/${memo.id}/recently-deleted`, {
      data: { expectedRevision: deletedBody.revision },
      headers: { Cookie: owner.cookie },
    });
    const restoredBody = (await restored.json()) as { revision: string };
    const deletedAgain = await request.post(`${API}/api/v1/memos/${memo.id}/recently-deleted`, {
      data: { expectedRevision: restoredBody.revision },
      headers: { Cookie: owner.cookie },
    });
    const deletedAgainBody = (await deletedAgain.json()) as { revision: string };
    await request.post(`${API}/api/v1/test-support/deletion-faults`, {
      data: { suppressionWriteFailure: true },
      headers: { Cookie: owner.cookie },
    });
    const purgeGrant = await reauth(request, owner.cookie, "purge");
    const purge = await request.post(`${API}/api/v1/memos/${memo.id}/purge`, {
      data: { expectedRevision: deletedAgainBody.revision },
      headers: { Cookie: owner.cookie, "x-reauth-grant": purgeGrant },
    });
    expect((await purge.json()) as Record<string, unknown>).toMatchObject({
      lifecycleState: "purging",
    });
    const failed = await request.post(`${API}/api/v1/test-support/memos/${memo.id}/purge-retry`, {
      headers: { Cookie: owner.cookie },
    });
    expect((await failed.json()) as Record<string, unknown>).toMatchObject({
      hardDeleted: false,
      state: "suppression_pending",
    });
    const history = (await (
      await request.get(`${API}/api/v1/memos`, { headers: { Cookie: owner.cookie } })
    ).json()) as { items: { id: string }[] };
    expect(history.items.some((item) => item.id === memo.id)).toBe(false);
    await request.post(`${API}/api/v1/test-support/deletion-faults`, {
      data: { suppressionWriteFailure: false },
      headers: { Cookie: owner.cookie },
    });
    expect(
      await (
        await request.post(`${API}/api/v1/test-support/memos/${memo.id}/purge-retry`, {
          headers: { Cookie: owner.cookie },
        })
      ).json(),
    ).toMatchObject({ hardDeleted: true, state: "purged", suppressionDurable: true });
  });

  test("account grace is cancelable; irreversible purge and provider failure remain explicit", async ({
    page,
    request,
  }) => {
    const owner = await signupAndVerify(request, "account-delete");
    const other = await signupAndVerify(request, "account-delete-other");
    await browserLogin(page, owner.email);
    await page.getByLabel(/I understand journal access/).check();
    await page.getByTestId("account-deletion-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Start account deletion" }).click();
    await expect(page.getByTestId("account-deletion-grace")).toBeVisible();
    expect(
      (
        await request.get(`${API}/api/v1/memos`, {
          failOnStatusCode: false,
          headers: { Cookie: owner.cookie },
        })
      ).status(),
    ).toBe(409);
    await page.getByRole("button", { name: "Cancel account deletion" }).click();
    await expect(page.getByRole("button", { name: "Start account deletion" })).toBeVisible();

    const grant = await reauth(request, owner.cookie, "account_delete");
    const requested = await request.post(`${API}/api/v1/me/account-deletion`, {
      data: { confirmation: "DELETE_MY_CASHMEMO_ACCOUNT" },
      headers: {
        Cookie: owner.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        "x-reauth-grant": grant,
      },
    });
    const deletion = (await requested.json()) as { graceEndsAt: string };
    expect(
      (
        await request.get(`${API}/api/v1/me/account-deletion`, {
          failOnStatusCode: false,
          headers: { Cookie: other.cookie },
        })
      ).status(),
    ).toBe(404);
    const advanced = await request.post(`${API}/api/v1/test-support/account-deletion/advance`, {
      data: { now: deletion.graceEndsAt, providerFailure: true },
      headers: { Cookie: owner.cookie },
    });
    expect(advanced.status()).toBe(200);
    expect((await advanced.json()) as Record<string, unknown>).toMatchObject({
      deletion: { providerState: "escalated", state: "provider_pending" },
      purge: { hardDeletedContent: true, state: "live_purged", suppressionDurable: true },
    });
  });

  test("contract storage and suppression faults preserve explicit retryable state", async ({
    request,
  }) => {
    const exportOwner = await signupAndVerify(request, "fault-export");
    await request.post(`${API}/api/v1/test-support/deletion-faults`, {
      data: { exportWriteFailure: true },
      headers: { Cookie: exportOwner.cookie },
    });
    const failedExport = await requestExport(request, exportOwner.cookie);
    await expect
      .poll(
        async () =>
          (await exportStatus(request, exportOwner.cookie, failedExport.id)).body["state"],
      )
      .toBe("failed");
    await request.post(`${API}/api/v1/test-support/deletion-faults`, {
      data: { exportWriteFailure: false },
      headers: { Cookie: exportOwner.cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const retry = await request.post(
      `${API}/api/v1/test-support/exports/${failedExport.id}/retry`,
      {
        data: { includeRecoverableDrafts: false },
        headers: { Cookie: exportOwner.cookie },
      },
    );
    expect((await retry.json()) as Record<string, unknown>).toMatchObject({ state: "ready" });

    const deletionOwner = await signupAndVerify(request, "fault-deletion");
    const grant = await reauth(request, deletionOwner.cookie, "account_delete");
    const requested = await request.post(`${API}/api/v1/me/account-deletion`, {
      data: { confirmation: "DELETE_MY_CASHMEMO_ACCOUNT" },
      headers: {
        Cookie: deletionOwner.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        "x-reauth-grant": grant,
      },
    });
    const deletion = (await requested.json()) as { graceEndsAt: string };
    await request.post(`${API}/api/v1/test-support/deletion-faults`, {
      data: { suppressionWriteFailure: true },
      headers: { Cookie: deletionOwner.cookie },
    });
    const pending = await request.post(`${API}/api/v1/test-support/account-deletion/advance`, {
      data: { now: deletion.graceEndsAt },
      headers: { Cookie: deletionOwner.cookie },
    });
    expect(await pending.json()).toMatchObject({
      deletion: { state: "purging" },
      purge: { hardDeletedContent: false, state: "suppression_pending" },
    });
    await request.post(`${API}/api/v1/test-support/deletion-faults`, {
      data: { suppressionWriteFailure: false },
      headers: { Cookie: deletionOwner.cookie },
    });
    const retried = await request.post(`${API}/api/v1/test-support/account-deletion/advance`, {
      data: { now: deletion.graceEndsAt },
      headers: { Cookie: deletionOwner.cookie },
    });
    expect(await retried.json()).toMatchObject({
      deletion: { state: "complete" },
      purge: { hardDeletedContent: true, state: "live_purged" },
    });
  });
});
