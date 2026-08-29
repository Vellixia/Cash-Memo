import { expect, test } from "./support/test";
import { provisionUser } from "./support/auth";
import { createTransaction } from "./support/transactions";

test("timezone change preserves instant, changes grouping, and refreshes transaction defaults", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await provisionUser(page, "settings-timezone", "UTC");

  const transactionId = await createTransaction(page, {
    amount: "7.00",
    category: "Food & Drink",
    direction: "expense",
    note: "Timezone consequence",
  });
  const beforeInstant = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/transactions/${id}`);
    return ((await response.json()) as { occurred_at: string }).occurred_at;
  }, transactionId);
  await page.goto("/app/transactions");
  const beforeDisplay = await page.getByRole("article", { name: /Expense/ }).locator("time").innerText();

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

  await page.goto("/app/transactions/new");
  await expect(page.getByLabel("Occurred at")).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Loading timezone…");
  const timezone = await page.evaluate(async () => {
    const response = await fetch("/api/v1/transactions/entry-defaults");
    return ((await response.json()) as { timezone: string }).timezone;
  });
  expect(timezone).toBe("Pacific/Honolulu");

  await page.goto("/app/settings/sessions");
  await expect(page.getByText("Current session")).toBeVisible();
  await page.getByRole("button", { name: "Sign out all sessions" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("including this one");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Sign out this session" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
