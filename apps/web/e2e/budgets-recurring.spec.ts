import { expect, test } from "./support/test";
import { provisionUser } from "./support/auth";

function cssTimeMilliseconds(value: string): number {
  const amount = Number.parseFloat(value);
  return value.endsWith("ms") ? amount : amount * 1_000;
}

test("updates a server-owned budget and pauses then resumes a recurring rule", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = await provisionUser(page, "budgets-recurring");

  await page.goto("/app/budgets");
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New budget", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Month", { exact: true })).not.toHaveValue("");
  await page.getByLabel("Category").selectOption({ label: "Food & Drink" });
  await page.getByLabel("Currency").selectOption("USD");
  await page.getByLabel("Budget amount").fill("100.00");
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByRole("status")).toContainText("Budget saved");
  await expect(page.getByRole("article").filter({ hasText: "Food & Drink" })).toContainText(
    "100.00",
  );

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Budget amount").fill("125.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Food & Drink" })).toContainText(
    "125.00",
  );

  await page.goto("/app/recurring");
  await expect(
    page.getByRole("heading", { name: "Recurring transactions", level: 1 }),
  ).toBeVisible();
  const createRule = page.getByRole("button", { name: "New recurring rule" });
  const reducedMotion = await createRule.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      animationIterationCount: style.animationIterationCount,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(cssTimeMilliseconds(reducedMotion.animationDuration)).toBeCloseTo(0.01, 5);
  expect(cssTimeMilliseconds(reducedMotion.transitionDuration)).toBeCloseTo(0.01, 5);
  expect(reducedMotion.animationIterationCount).toBe("1");
  await createRule.click();
  await page.getByLabel("Wallet").selectOption({ label: `${user.walletName} — USD` });
  await page.getByLabel("Category").selectOption({ label: "Food & Drink" });
  await page.getByLabel("Amount").fill("15.00");
  await page.getByLabel("Frequency").selectOption("weekly");
  await page.getByLabel("Start date").fill(new Date().toISOString().slice(0, 10));
  const recurringNote = `Weekly lunch ${user.email}`;
  await page.getByLabel("Note").fill(recurringNote);
  await page.getByRole("button", { name: "Create recurring rule" }).click();

  const recurringCard = page.getByRole("article").filter({ hasText: recurringNote });
  await expect(recurringCard).toContainText("Active");
  await recurringCard.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("status")).toContainText("Recurring rule paused");
  await expect(recurringCard).toContainText("Paused");
  await recurringCard.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("status")).toContainText("Recurring rule resumed");
  await expect(recurringCard).toContainText("Active");
});
