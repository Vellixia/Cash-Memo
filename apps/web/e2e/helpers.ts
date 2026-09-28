import { expect, test as base, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const PASSWORD = "correct-horse-9";

export function uniqueEmail(tag = "e2e") {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.io`;
}

type SourceKind = "cash" | "bank" | "ewallet" | "credit" | "paylater" | "other";
type Category = { id: string; name: string; direction: "income" | "expense"; emoji: string | null };
type Source = {
  id: string;
  name: string;
  kind: SourceKind;
  emoji: string | null;
  track_balance: boolean;
  currency: string | null;
  opening_minor: number;
  credit_limit_minor: number | null;
  statement_day: number | null;
  due_day: number | null;
  archived_at: string | null;
  balance_minor: number | null;
};
type SourceInput = {
  name: string;
  kind: SourceKind;
  emoji?: string | null;
  track_balance?: boolean;
  currency?: string | null;
  opening_minor?: number;
  credit_limit_minor?: number | null;
  statement_day?: number | null;
  due_day?: number | null;
};
type MemoInput = {
  direction: "income" | "expense" | "transfer";
  amount_minor: number;
  currency?: string;
  occurred_at?: string;
  category_id?: string | null;
  source_id?: string | null;
  to_source_id?: string | null;
  note?: string | null;
};

/** API helper bound to a page's cookie jar (page.request shares the browser context's cookies). */
export function apiFor(request: APIRequestContext) {
  const call = async <T>(method: "get" | "post" | "patch" | "delete", path: string, data?: unknown): Promise<T> => {
    const res = await request[method](`/api${path}`, data === undefined ? undefined : { data });
    expect(res.ok(), `${method.toUpperCase()} ${path} -> ${res.status()} ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? undefined : await res.json()) as T;
  };
  return {
    signup: (email = uniqueEmail(), password = PASSWORD) => call<{ id: string; email: string }>("post", "/auth/signup", { email, password }),
    category: (name: string, direction: "income" | "expense" = "expense", emoji: string | null = null) =>
      call<Category>("post", "/categories", { name, direction, emoji }),
    source: (input: SourceInput) => call<Source>("post", "/sources", input),
    memo: async (m: MemoInput) => {
      let body: MemoInput & { currency: string; occurred_at: string } = {
        currency: "USD",
        occurred_at: new Date().toISOString(),
        ...m,
      };
      // An expense now needs a source; default to the account's first active one (every account starts with "Cash").
      if (body.direction === "expense" && !body.source_id) {
        const sources = await call<Source[]>("get", "/sources");
        const active = sources.find((s) => !s.archived_at);
        if (active) body = { ...body, source_id: active.id };
      }
      return call<{ id: string }>("post", "/memos", body);
    },
  };
}

/** A random private IP, so each test's auth calls get their own rate-limit bucket. */
export function fakeIp() {
  const octet = () => 1 + Math.floor(Math.random() * 254);
  return `10.${octet()}.${octet()}.${octet()}`;
}

/** A signed-out API context (its own cookie jar) with its own fake client IP. */
export function anonRequest(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }) {
  return playwright.request.newContext({ baseURL: base.info().project.use.baseURL, extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
}

/** Each test gets a fresh signed-in user (unless it opts out) and fails on any page or console error. */
export const test = base.extend<{
  user: { email: string };
  api: ReturnType<typeof apiFor>;
  allowConsole: (pattern: RegExp) => void;
  /** Bottom-tab layout (viewport < 768). From 768 up the top bar takes over. */
  isMobile: boolean;
  /** Two-column desktop dashboard (viewport >= 1024). */
  isWide: boolean;
  /** A unique fake client IP per test context, so parallel signups/logins never trip the API's per-IP
   * rate limits (the web proxy trusts `x-forwarded-for` when there's no CF-Connecting-IP). */
  clientIp: void;
}>({
  clientIp: [
    async ({ page }, provide) => {
      await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
      await provide();
    },
    { auto: true },
  ],
  allowConsole: [
    async ({ page }, provide) => {
      const allowed: RegExp[] = [];
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error" && !allowed.some((re) => re.test(msg.text()))) errors.push(`console: ${msg.text()}`);
      });
      await provide((re) => allowed.push(re));
      expect(errors, "page/console errors").toEqual([]);
    },
    { auto: true },
  ],
  // Depends on clientIp so the fake IP header is set before any signup/login call.
  api: async ({ page, clientIp }, provide) => {
    void clientIp;
    provide(apiFor(page.request));
  },
  user: async ({ api }, provide) => provide(await api.signup()),
  isMobile: async ({}, provide, info) => provide(projectWidth(info.project.use.viewport) < 768),
  isWide: async ({}, provide, info) => provide(projectWidth(info.project.use.viewport) >= 1024),
});

const projectWidth = (viewport: { width: number } | null | undefined) => viewport?.width ?? 1280;

export { expect };

/** Categories: tabs below 1024, both lists side by side from 1024. Returns the visible list's region. */
export async function showCategories(page: Page, direction: "expense" | "income") {
  const title = direction === "income" ? "Income" : "Expense";
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("radiogroup", { name: "Category type" }).getByRole("radio", { name: title }).click();
  }
  const section = page.getByRole("region", { name: `${title} categories` });
  await expect(section).toBeVisible();
  return section;
}

export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "element has a layout box").not.toBeNull();
  return b!;
}

export async function openNewMemo(page: Page, isMobile: boolean) {
  await page.getByRole("button", { name: isMobile ? "Add memo" : "New memo" }).click();
  const dialog = page.getByTestId("memo-editor");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Amount")).toBeFocused();
  return dialog;
}

/** Waits for the home page to have loaded its data. */
export async function gotoHome(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("hero-net")).toBeVisible();
}

export async function noHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}
