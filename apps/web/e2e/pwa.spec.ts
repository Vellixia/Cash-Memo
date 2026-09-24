import { expect, gotoHome, test } from "./helpers";

test("manifest is installable: standalone, 192/512 icons and a maskable icon, all served", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m).toMatchObject({ name: "Cash Memo", start_url: "/", display: "standalone" });
  const sizes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? "any"}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  for (const icon of m.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBeTruthy();
  }
  for (const path of ["/sw.js", "/offline"]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  }
});

test("works offline: cached home and ledger load without a network, with an offline banner", async ({
  page,
  context,
  api,
  user,
  allowConsole,
}) => {
  void user;
  allowConsole(/ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/);
  await api.memo({ direction: "expense", amount_minor: 1234, note: "Offline coffee" });

  await gotoHome(page);
  // First load installs the worker; it controls the page from the next navigation.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByText("Offline coffee")).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "You're offline" })).toBeVisible();
  await expect(page.getByText("Offline coffee")).toBeVisible();

  // A page never visited online falls back to the offline screen.
  await page.goto("/never-visited");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();

  await context.setOffline(false);
});

test("logging out wipes cached API data from the device", async ({ page, api, user }) => {
  void user;
  await api.memo({ direction: "expense", amount_minor: 500, note: "Private lunch" });
  await gotoHome(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByText("Private lunch")).toBeVisible();

  const cachedApi = () =>
    page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
      }
      return urls.filter((u) => u.startsWith("/api/"));
    });
  await expect.poll(cachedApi).toContain("/api/memos");

  // From the page so the request passes through the service worker.
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await expect.poll(cachedApi).toEqual([]);
});
