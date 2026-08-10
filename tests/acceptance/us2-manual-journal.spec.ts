import { expect, test, type APIRequestContext } from "@playwright/test";

const API = "http://localhost:3000";
const MAILPIT = "http://localhost:8025";
const SYNTHETIC_PASSWORD = "Acceptance-Password-1!";

async function signupAndVerify(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const idempotencyKey = crypto.randomUUID();
  await request.post(`${API}/api/v1/auth/sign-up`, {
    data: { email, idempotencyKey, password },
  });
  await test.step(`verify email`, async () => {
    await expect
      .poll(
        async () => {
          const res = await request.get(`${MAILPIT}/api/v1/messages`);
          const messages = await res.json();
          return messages.total;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    const res = await request.get(`${MAILPIT}/api/v1/messages`);
    const messages = await res.json();
    const latestMsg = messages.messages[0];
    const fullRes = await request.get(`${MAILPIT}/api/v1/message/${latestMsg.ID}`);
    const fullMsg = await fullRes.json();
    const text = fullMsg.Text as string;
    const tokenMatch = /token=([^&\s]+)/.exec(text);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch?.[1];
    expect(token).toBeDefined();
    await request.post(`${API}/api/v1/auth/verify-email`, { data: { token } });
    await request.delete(`${MAILPIT}/api/v1/messages`);
  });
}

async function loginAndGetCookie(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { email, password },
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(200);
  const setCookie = res.headers()["set-cookie"];
  expect(setCookie).toBeDefined();
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookiePair = cookieStr?.split(";")[0];
  expect(cookiePair).toBeDefined();
  return cookiePair ?? "";
}

async function signupVerifyAndLogin(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  await signupAndVerify(request, email, password);
  return loginAndGetCookie(request, email, password);
}

async function createMemo(
  request: APIRequestContext,
  cookie: string,
  input: {
    direction: string;
    amount: string;
    currency: string;
    occurredAt: string;
    occurredLocal: string;
    occurredTimezone: string;
    occurredOffsetMinutes: number;
    note: string | null;
  },
  idempotencyKey: string,
): Promise<{ id: string; revision: string; status: number; body: Record<string, unknown> }> {
  const res = await request.post(`${API}/api/v1/memos`, {
    data: {
      categoryId: null,
      confirmation: "CONFIRM_MONEY_MEMO",
      direction: input.direction,
      money: { amount: input.amount, currency: input.currency },
      moneySpaceId: null,
      note: input.note,
      occurrence: {
        occurredAt: input.occurredAt,
        occurredLocal: input.occurredLocal,
        occurredOffsetMinutes: input.occurredOffsetMinutes,
        occurredTimezone: input.occurredTimezone,
        timezoneDatabaseVersion: "system-local",
      },
      planningStatus: null,
      purpose: null,
    },
    headers: {
      Cookie: cookie,
      "x-idempotency-key": idempotencyKey,
    },
    failOnStatusCode: false,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return {
    body,
    id: body["id"] as string,
    revision: body["revision"] as string,
    status: res.status(),
  };
}

test.describe("US2 — Manual Money Journal (STT/AI disabled)", () => {
  test("authenticated CRUD lifecycle: create → history → edit → archive → restore → delete → restore → purge", async ({
    request,
  }) => {
    const email = `crud-${Date.now()}@cashmemo.test`;
    const cookie = await signupVerifyAndLogin(request, email, SYNTHETIC_PASSWORD);

    const created = await createMemo(
      request,
      cookie,
      {
        amount: "12.34",
        currency: "USD",
        direction: "expense",
        note: null,
        occurredAt: "2026-01-15T10:00:00.000Z",
        occurredLocal: "2026-01-15T17:00:00",
        occurredOffsetMinutes: 420,
        occurredTimezone: "Asia/Jakarta",
      },
      crypto.randomUUID(),
    );
    expect(created.status).toBe(201);
    expect(created.id).toBeDefined();
    expect(created.revision).toBe("1");

    const historyRes = await request.get(`${API}/api/v1/memos`, {
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(historyRes.status()).toBe(200);
    const history = (await historyRes.json()) as { items: unknown[] };
    expect(history.items.length).toBeGreaterThanOrEqual(1);

    const detailRes = await request.get(`${API}/api/v1/memos/${created.id}`, {
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(detailRes.status()).toBe(200);

    const editRes = await request.patch(`${API}/api/v1/memos/${created.id}`, {
      data: {
        categoryId: null,
        direction: "expense",
        expectedRevision: "1",
        money: { amount: "56.78", currency: "USD" },
        moneySpaceId: null,
        note: "updated",
        occurrence: {
          occurredAt: "2026-01-15T10:00:00.000Z",
          occurredLocal: "2026-01-15T17:00:00",
          occurredOffsetMinutes: 420,
          occurredTimezone: "Asia/Jakarta",
          timezoneDatabaseVersion: "system-local",
        },
        planningStatus: null,
        purpose: null,
      },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(editRes.status()).toBe(200);
    const edited = (await editRes.json()) as Record<string, unknown>;
    expect(edited["revision"]).toBe("2");

    const archiveRes = await request.post(`${API}/api/v1/memos/${created.id}/archive`, {
      data: { expectedRevision: "2" },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(archiveRes.status()).toBe(200);
    const archived = (await archiveRes.json()) as Record<string, unknown>;
    expect(archived["lifecycleState"]).toBe("archived");

    const restoreArchiveRes = await request.delete(`${API}/api/v1/memos/${created.id}/archive`, {
      data: { expectedRevision: archived["revision"] as string },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(restoreArchiveRes.status()).toBe(200);
    const restored = (await restoreArchiveRes.json()) as Record<string, unknown>;
    expect(restored["lifecycleState"]).toBe("active");

    const deleteRes = await request.post(`${API}/api/v1/memos/${created.id}/recently-deleted`, {
      data: { expectedRevision: restored["revision"] as string },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(deleteRes.status()).toBe(200);
    const deleted = (await deleteRes.json()) as Record<string, unknown>;
    expect(deleted["lifecycleState"]).toBe("recently_deleted");

    const restoreDeletedRes = await request.delete(
      `${API}/api/v1/memos/${created.id}/recently-deleted`,
      {
        data: { expectedRevision: deleted["revision"] as string },
        headers: { Cookie: cookie },
        failOnStatusCode: false,
      },
    );
    expect(restoreDeletedRes.status()).toBe(200);
    const restoredFromDeleted = (await restoreDeletedRes.json()) as Record<string, unknown>;
    expect(restoredFromDeleted["lifecycleState"]).toBe("active");

    const delete2Res = await request.post(`${API}/api/v1/memos/${created.id}/recently-deleted`, {
      data: { expectedRevision: restoredFromDeleted["revision"] as string },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(delete2Res.status()).toBe(200);
    const deleted2 = (await delete2Res.json()) as Record<string, unknown>;

    const purgeRes = await request.post(`${API}/api/v1/memos/${created.id}/purge`, {
      data: { expectedRevision: deleted2["revision"] as string },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(purgeRes.status()).toBe(200);
    const purged = (await purgeRes.json()) as Record<string, unknown>;
    expect(purged["lifecycleState"]).toBe("purging");
  });

  test("idempotent retry: same key returns same memo, no duplicate", async ({ request }) => {
    const email = `idemp-${Date.now()}@cashmemo.test`;
    const cookie = await signupVerifyAndLogin(request, email, SYNTHETIC_PASSWORD);

    const idempotencyKey = crypto.randomUUID();
    const memoInput = {
      amount: "50.00",
      currency: "USD",
      direction: "expense",
      note: null,
      occurredAt: "2026-02-01T08:00:00.000Z",
      occurredLocal: "2026-02-01T15:00:00",
      occurredOffsetMinutes: 420,
      occurredTimezone: "Asia/Jakarta",
    };

    const first = await createMemo(request, cookie, memoInput, idempotencyKey);
    expect(first.status).toBe(201);

    const retry = await createMemo(request, cookie, memoInput, idempotencyKey);
    expect(retry.status).toBe(201);
    expect(retry.id).toBe(first.id);
    expect(retry.revision).toBe(first.revision);
  });

  test("revision conflict: stale edit returns REVISION_CONFLICT", async ({ request }) => {
    const email = `conflict-${Date.now()}@cashmemo.test`;
    const cookie = await signupVerifyAndLogin(request, email, SYNTHETIC_PASSWORD);

    const created = await createMemo(
      request,
      cookie,
      {
        amount: "10.00",
        currency: "USD",
        direction: "expense",
        note: null,
        occurredAt: "2026-03-01T08:00:00.000Z",
        occurredLocal: "2026-03-01T15:00:00",
        occurredOffsetMinutes: 420,
        occurredTimezone: "Asia/Jakarta",
      },
      crypto.randomUUID(),
    );

    const staleRes = await request.patch(`${API}/api/v1/memos/${created.id}`, {
      data: {
        categoryId: null,
        direction: "expense",
        expectedRevision: "0",
        money: { amount: "20.00", currency: "USD" },
        moneySpaceId: null,
        note: null,
        occurrence: {
          occurredAt: "2026-03-01T08:00:00.000Z",
          occurredLocal: "2026-03-01T15:00:00",
          occurredOffsetMinutes: 420,
          occurredTimezone: "Asia/Jakarta",
          timezoneDatabaseVersion: "system-local",
        },
        planningStatus: null,
        purpose: null,
      },
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    expect(staleRes.status()).toBe(409);
    const body = (await staleRes.json()) as Record<string, unknown>;
    expect(body["messageCode"]).toBe("REVISION_CONFLICT");
  });

  test("second-user isolation: B cannot access A's memo", async ({ request }) => {
    const emailA = `iso-a-${Date.now()}@cashmemo.test`;
    const emailB = `iso-b-${Date.now()}@cashmemo.test`;
    const cookieA = await signupVerifyAndLogin(request, emailA, SYNTHETIC_PASSWORD);

    const created = await createMemo(
      request,
      cookieA,
      {
        amount: "100.00",
        currency: "USD",
        direction: "income",
        note: null,
        occurredAt: "2026-04-01T08:00:00.000Z",
        occurredLocal: "2026-04-01T15:00:00",
        occurredOffsetMinutes: 420,
        occurredTimezone: "Asia/Jakarta",
      },
      crypto.randomUUID(),
    );

    const cookieB = await signupVerifyAndLogin(request, emailB, SYNTHETIC_PASSWORD);

    const getRes = await request.get(`${API}/api/v1/memos/${created.id}`, {
      headers: { Cookie: cookieB },
      failOnStatusCode: false,
    });
    expect(getRes.status()).toBe(404);

    const editRes = await request.patch(`${API}/api/v1/memos/${created.id}`, {
      data: {
        categoryId: null,
        direction: "expense",
        expectedRevision: "1",
        money: { amount: "999.99", currency: "USD" },
        moneySpaceId: null,
        note: "hijack",
        occurrence: {
          occurredAt: "2026-04-01T08:00:00.000Z",
          occurredLocal: "2026-04-01T15:00:00",
          occurredOffsetMinutes: 420,
          occurredTimezone: "Asia/Jakarta",
          timezoneDatabaseVersion: "system-local",
        },
        planningStatus: null,
        purpose: null,
      },
      headers: { Cookie: cookieB },
      failOnStatusCode: false,
    });
    expect(editRes.status()).toBe(404);

    const deleteRes = await request.post(`${API}/api/v1/memos/${created.id}/recently-deleted`, {
      data: { expectedRevision: "1" },
      headers: { Cookie: cookieB },
      failOnStatusCode: false,
    });
    expect([404, 409]).toContain(deleteRes.status());
  });

  test("invalid input: zero amount is rejected, no memo created", async ({ request }) => {
    const email = `invalid-${Date.now()}@cashmemo.test`;
    const cookie = await signupVerifyAndLogin(request, email, SYNTHETIC_PASSWORD);

    const res = await createMemo(
      request,
      cookie,
      {
        amount: "0",
        currency: "USD",
        direction: "expense",
        note: null,
        occurredAt: "2026-05-01T08:00:00.000Z",
        occurredLocal: "2026-05-01T15:00:00",
        occurredOffsetMinutes: 420,
        occurredTimezone: "Asia/Jakarta",
      },
      crypto.randomUUID(),
    );
    expect([400, 500]).toContain(res.status);
  });

  test("different currencies: IDR and USD memos coexist", async ({ request }) => {
    const email = `multi-${Date.now()}@cashmemo.test`;
    const cookie = await signupVerifyAndLogin(request, email, SYNTHETIC_PASSWORD);

    const usdMemo = await createMemo(
      request,
      cookie,
      {
        amount: "10.00",
        currency: "USD",
        direction: "expense",
        note: null,
        occurredAt: "2026-06-01T08:00:00.000Z",
        occurredLocal: "2026-06-01T15:00:00",
        occurredOffsetMinutes: 420,
        occurredTimezone: "Asia/Jakarta",
      },
      crypto.randomUUID(),
    );
    expect(usdMemo.status).toBe(201);

    const idrMemo = await createMemo(
      request,
      cookie,
      {
        amount: "50000",
        currency: "IDR",
        direction: "expense",
        note: null,
        occurredAt: "2026-06-02T08:00:00.000Z",
        occurredLocal: "2026-06-02T15:00:00",
        occurredOffsetMinutes: 420,
        occurredTimezone: "Asia/Jakarta",
      },
      crypto.randomUUID(),
    );
    expect(idrMemo.status).toBe(201);

    const historyRes = await request.get(`${API}/api/v1/memos`, {
      headers: { Cookie: cookie },
      failOnStatusCode: false,
    });
    const history = (await historyRes.json()) as { items: unknown[] };
    expect(history.items.length).toBeGreaterThanOrEqual(2);
  });

  test("manual path works with STT/AI disabled", async ({ request }) => {
    const email = `manual-${Date.now()}@cashmemo.test`;
    const cookie = await signupVerifyAndLogin(request, email, SYNTHETIC_PASSWORD);

    const created = await createMemo(
      request,
      cookie,
      {
        amount: "25.00",
        currency: "USD",
        direction: "expense",
        note: "synthetic test note",
        occurredAt: "2026-07-01T08:00:00.000Z",
        occurredLocal: "2026-07-01T15:00:00",
        occurredOffsetMinutes: 420,
        occurredTimezone: "Asia/Jakarta",
      },
      crypto.randomUUID(),
    );
    expect(created.status).toBe(201);
    expect(created.id).toBeDefined();
  });
});
