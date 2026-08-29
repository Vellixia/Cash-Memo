import { expect, test } from "./support/test";
import { login, provisionUser } from "./support/auth";
import { createTransaction } from "./support/transactions";

test("timezone change preserves instant, changes grouping, and refreshes transaction defaults", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = await provisionUser(page, "settings-timezone", "UTC");

  const transactionId = await createTransaction(page, {
    amount: "7.00",
    category: "Food & Drink",
    direction: "expense",
    note: "Timezone consequence",
    occurredLocal: "2026-01-01T00:30",
  });
  const beforeInstant = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/transactions/${id}`);
    return ((await response.json()) as { occurred_at: string }).occurred_at;
  }, transactionId);
  await page.goto("/app/transactions");
  const beforeDisplay = await page.getByRole("article", { name: /Expense/ }).locator("time").innerText();
  await page.goto("/app?month=2026-01");
  await expect(page.locator('section[aria-labelledby="monthly-heading"]')).toContainText("7.00");

  await page.goto("/app/settings");
  await page.getByLabel("Timezone").fill("Pacific/Honolulu");
  await page.getByRole("option", { name: "Pacific/Honolulu", exact: true }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Pacific/Honolulu");
  await expect(confirmation).toContainText("stored transaction instants stay unchanged");
  await confirmation.getByRole("button", { name: "Confirm timezone change" }).click();
  await expect(page.getByRole("status")).toContainText("Preferences saved");

  const afterInstant = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/transactions/${id}`);
    return ((await response.json()) as { occurred_at: string }).occurred_at;
  }, transactionId);
  expect(afterInstant).toBe(beforeInstant);
  await page.goto("/app/transactions");
  const afterDisplay = await page.getByRole("article", { name: /Expense/ }).locator("time").innerText();
  expect(afterDisplay).not.toBe(beforeDisplay);
  await page.goto("/app?month=2025-12");
  await expect(page.locator('section[aria-labelledby="monthly-heading"]')).toContainText("7.00");

  await page.goto("/app/transactions/new");
  await expect(page.getByLabel("Occurred at")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Loading timezone…");
  const expectedLocal = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Honolulu",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  });
  await expect(page.getByLabel("Occurred at")).toHaveValue(expectedLocal);

  await page.goto("/app/settings/sessions");
  await expect(page.getByText("Current session")).toBeVisible();
  const allRevoke = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/auth/sessions/revoke-all",
  );
  await page.getByRole("button", { name: "Sign out all sessions" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("including this one");
  await page.getByRole("button", { name: "Confirm sign out all sessions" }).click();
  expect((await allRevoke).ok()).toBe(true);
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(async () => page.evaluate(async () => (await fetch("/api/v1/auth/sessions/current")).status)).toBe(401);
  await login(page, user);
  await page.goto("/app/settings/sessions");
  const currentLogout = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/auth/logout",
  );
  await page.getByRole("button", { name: "Sign out this session" }).click();
  expect((await currentLogout).ok()).toBe(true);
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(async () => page.evaluate(async () => (await fetch("/api/v1/auth/sessions/current")).status)).toBe(401);
});
