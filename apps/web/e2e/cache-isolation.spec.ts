import { expect, test, type APIResponse, type Route } from "./support/test";
import { apiUrl, connectPageToRealApi } from "./support/api";
import { login, provisionUser } from "./support/auth";
import { createTransaction } from "./support/transactions";

async function opaqueFailure(response: APIResponse) {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return { status: response.status(), code: body.error.code, message: body.error.message };
}

test("session transition cannot reuse private cache and ownership failures reveal nothing", async ({
  browser,
  page,
}) => {
  const first = await provisionUser(page, "cache-owner");
  const privateNote = `Owner-only ${first.email}`;
  const transactionId = await createTransaction(page, {
    amount: "41.00",
    category: "Food & Drink",
    direction: "expense",
    note: privateNote,
  });

  await page.goto("/app");
  await expect(page.getByText(privateNote, { exact: true })).toBeVisible();
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__Host-cashmemo_session",
  );
  expect(sessionCookie).toBeDefined();
  expect({
    secure: sessionCookie?.secure,
    httpOnly: sessionCookie?.httpOnly,
    sameSite: sessionCookie?.sameSite,
    path: sessionCookie?.path,
    domain: sessionCookie?.domain,
  }).toEqual({
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    domain: "localhost",
  });

  const walletApi = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/wallets",
  );
  const privateHtml = await page.goto("/app/wallets");
  expect(privateHtml?.headers()["cache-control"]).toContain("no-store");
  expect((await walletApi).headers()["cache-control"]).toContain("no-store");
  await expect(page.getByRole("heading", { name: first.walletName, level: 2 })).toBeVisible();

  await page.goto("/app");
  const rscHeaders = await page.evaluate(async () => {
    const response = await fetch("/app/wallets", { headers: { RSC: "1" } });
    await response.text();
    return {
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
    };
  });
  expect(rscHeaders.cacheControl).toContain("no-store");
  expect(rscHeaders.contentType).toContain("text/x-component");

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await connectPageToRealApi(ownerPage);
  await login(ownerPage, first);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const second = await provisionUser(secondPage, "cache-other");
  await secondContext.close();

  let aRequestSeen = false;
  let aUpstreamBodyValidated = false;
  let aFulfillAttempted = false;
  let aRequestOutcome: "finished" | "failed" | undefined;
  let aHeldRequestUrl: string | undefined;
  let pendingAtLogoutRequest = false;
  let pendingAtLogoutResponse = false;
  const lifecycleEvents: string[] = [];
  let releaseAResponse!: () => void;
  const aResponseHeld = new Promise<void>((resolve) => {
    releaseAResponse = resolve;
  });
  let resolveFulfillAttempt!: () => void;
  const fulfillAttempt = new Promise<void>((resolve) => {
    resolveFulfillAttempt = resolve;
  });
  const holdAResponse = async (route: Route) => {
    const request = route.request();
    if (!aRequestSeen && request.method() === "GET" && new URL(request.url()).pathname === "/api/v1/transactions") {
      aRequestSeen = true;
      aHeldRequestUrl = request.url();
      // Fetch upstream while A cookie is valid; delay only delivery into browser.
      const response = await route.fetch({ url: apiUrl(`${new URL(request.url()).pathname}${new URL(request.url()).search}`) });
      const body = await response.body();
      expect(body.toString("utf8")).toContain(privateNote);
      aUpstreamBodyValidated = true;
      await aResponseHeld;
      aFulfillAttempted = true;
      try {
        await route.fulfill({ response, body });
      } catch {
        // Cleanup may abort the browser request before fulfillment. Record outcome without leaking
        // transport details; either fulfillment or abort is an explicit late-delivery observation.
      } finally {
        resolveFulfillAttempt();
      }
      return;
    }
    await route.fallback();
  };
  page.on("requestfinished", (request) => {
    if (request.url() === aHeldRequestUrl) {
      aRequestOutcome = "finished";
      lifecycleEvents.push("history-finished");
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url() === aHeldRequestUrl) {
      aRequestOutcome = "failed";
      lifecycleEvents.push("history-failed");
    }
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/auth/logout") {
      pendingAtLogoutRequest = aRequestOutcome === undefined;
      lifecycleEvents.push("logout-request");
    }
  });
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/logout"
    ) {
      pendingAtLogoutResponse = aRequestOutcome === undefined;
      lifecycleEvents.push("logout-response");
    }
  });
  await page.route("**/api/v1/**", holdAResponse);
  // Hold mounted production History query response. Shell logout must clean it up without leaving
  // History, or observer unmount could become an unrelated source of cancellation.
  await page.goto("/app/transactions");
  await expect.poll(() => aRequestSeen).toBe(true);
  await expect.poll(() => aUpstreamBodyValidated).toBe(true);
  await expect(page.getByText("Loading transactions…")).toBeVisible();
  expect(aRequestOutcome).toBeUndefined();

  const logoutResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/logout",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  expect((await logoutResponse).ok()).toBe(true);
  await expect(page).toHaveURL(/\/login(?:\?returnTo=%2Fapp)?$/);
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  expect(pendingAtLogoutRequest).toBe(true);
  expect(pendingAtLogoutResponse).toBe(true);
  await expect
    .poll(() => aRequestOutcome, {
      message: "logout cleanup must abort held History request before login screen is visible",
      timeout: 5_000,
    })
    .toBe("failed");
  expect(lifecycleEvents.indexOf("logout-response")).toBeLessThan(
    lifecycleEvents.indexOf("history-failed"),
  );
  await expect(page.getByText(privateNote, { exact: true })).toHaveCount(0);

  await login(page, second);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(page.getByText(privateNote, { exact: true })).toHaveCount(0);
  await expect(page.getByText(first.walletName, { exact: true })).toHaveCount(0);
  releaseAResponse();
  await fulfillAttempt;
  expect(aFulfillAttempted).toBe(true);
  await expect.poll(() => aRequestOutcome).toMatch(/^(finished|failed)$/);
  await page.unroute("**/api/v1/**", holdAResponse);

  await page.goto("/app/transactions");
  await expect(page.getByText(privateNote, { exact: true })).toHaveCount(0);
  await expect(page.getByText(first.walletName, { exact: true })).toHaveCount(0);
  await page.goto("/app/wallets");
  await expect(page.getByText(second.walletName, { exact: true })).toHaveCount(1);
  await page.goto("/app");
  await expect(page.getByText(privateNote, { exact: true })).toHaveCount(0);
  const persistence = await page.evaluate(async () => {
    const storageText = [localStorage, sessionStorage]
      .flatMap((storage) =>
        Array.from({ length: storage.length }, (_, index) => storage.key(index)).map(
          (key) => `${key ?? ""}:${key ? (storage.getItem(key) ?? "") : ""}`,
        ),
      )
      .join("\n");
    const cacheBodies: string[] = [];
    const cacheUrls: string[] = [];
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        cacheUrls.push(request.url);
        const response = await cache.match(request);
        if (response) cacheBodies.push(await response.text());
      }
    }
    const databases = await indexedDB.databases();
    return {
      storageText,
      cacheNames,
      cacheUrls,
      cacheText: cacheBodies.join("\n"),
      databaseNames: databases.map((database) => database.name ?? ""),
    };
  });
  expect(persistence.storageText).not.toContain(first.walletName);
  expect(persistence.storageText).not.toContain(privateNote);
  expect(persistence.cacheText).not.toContain(first.walletName);
  expect(persistence.cacheText).not.toContain(privateNote);
  expect(persistence.databaseNames).toEqual([]);
  expect(persistence.cacheNames.every((name) => name === "cashmemo-static-v1")).toBe(true);
  const approvedStaticAsset =
    /^http:\/\/localhost:3000\/(?:_next\/static\/.+\.(?:js|css|woff2?|ttf|otf)|icons\/[^/]+\.(?:png|svg|ico)|manifest\.webmanifest|brand\/[^/]+\.(?:svg|png))(?:\?.*)?$/i;
  for (const url of persistence.cacheUrls) expect(url).toMatch(approvedStaticAsset);
  expect(persistence.cacheUrls.some((url) => /(?:\/app|\/deletion|\/api\/|_rsc=)/.test(url))).toBe(false);

  const missingId = "00000000-0000-4000-8000-000000000000";
  const [knownRead, unknownRead, knownPatch, unknownPatch, knownDelete, unknownDelete] =
    await Promise.all([
      page.request.get(apiUrl(`/api/v1/transactions/${transactionId}`)),
      page.request.get(apiUrl(`/api/v1/transactions/${missingId}`)),
      page.request.patch(apiUrl(`/api/v1/transactions/${transactionId}`), {
        data: { note: "stolen" },
      }),
      page.request.patch(apiUrl(`/api/v1/transactions/${missingId}`), {
        data: { note: "stolen" },
      }),
      page.request.delete(apiUrl(`/api/v1/transactions/${transactionId}`)),
      page.request.delete(apiUrl(`/api/v1/transactions/${missingId}`)),
    ]);
  expect(await opaqueFailure(knownRead)).toEqual(await opaqueFailure(unknownRead));
  expect(await opaqueFailure(knownPatch)).toEqual(await opaqueFailure(unknownPatch));
  expect(await opaqueFailure(knownDelete)).toEqual(await opaqueFailure(unknownDelete));

  const ownerRead = await ownerPage.request.get(apiUrl(`/api/v1/transactions/${transactionId}`));
  expect(ownerRead.ok()).toBe(true);
  const original = (await ownerRead.json()) as {
    amount: string;
    deleted_at: string | null;
    direction: string;
    note: string | null;
    purge_after: string | null;
  };
  expect({
    amount: original.amount,
    deletedAt: original.deleted_at,
    direction: original.direction,
    note: original.note,
    purgeAfter: original.purge_after,
  }).toEqual({
    amount: "41.00",
    deletedAt: null,
    direction: "expense",
    note: privateNote,
    purgeAfter: null,
  });

  const list = await page.request.get(apiUrl("/api/v1/transactions"));
  expect(list.ok()).toBe(true);
  expect(list.headers()["cache-control"]).toContain("no-store");
  const history = (await list.json()) as { items: { id: string; note?: string | null }[] };
  expect(history.items).not.toContainEqual(expect.objectContaining({ id: transactionId }));
  expect(history.items).not.toContainEqual(expect.objectContaining({ note: privateNote }));
  await ownerContext.close();
});
