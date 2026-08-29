import { expect, test } from "./support/test";
import { provisionUser } from "./support/auth";
import { createTransaction } from "./support/transactions";
import type { Page } from "@playwright/test";

function cssTimeMilliseconds(value: string): number {
  const amount = Number.parseFloat(value);
  return value.endsWith("ms") ? amount : amount * 1_000;
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("updates a server-owned budget and pauses then resumes a recurring rule", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = await provisionUser(page, "budgets-recurring");
  const ordinaryNote = `Ordinary memo ${user.email}`;
  await createTransaction(page, {
    amount: "42.00",
    category: "Food & Drink",
    direction: "expense",
    note: ordinaryNote,
  });
  await page.goto("/app/transactions");
  const ordinaryRow = page.getByRole("article").filter({ hasText: ordinaryNote });
  await expect(ordinaryRow).toHaveCount(1);
  const ordinarySnapshot = await ordinaryRow.evaluate((element) => ({
    text: element.textContent,
    label: element.getAttribute("aria-label"),
  }));
  async function expectOrdinaryUnchanged() {
    await page.goto("/app/transactions");
    const row = page.getByRole("article").filter({ hasText: ordinaryNote });
    await expect(row).toHaveCount(1);
    await expect
      .poll(() => row.evaluate((element) => ({
        text: element.textContent,
        label: element.getAttribute("aria-label"),
      })))
      .toEqual(ordinarySnapshot);
  }

  await page.goto("/app/budgets");
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New budget", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Month", { exact: true })).not.toHaveValue("");
  await chooseOption(page, "Category", "Food & Drink");
  await chooseOption(page, "Currency", "USD — US Dollar");
  await page.getByLabel("Budget amount").fill("25.00");
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByRole("status")).toContainText("Budget saved");
  const budgetCard = page.getByRole("article").filter({ hasText: "Food & Drink" });
  await expect(budgetCard).toContainText("Over budget");
  await expect(budgetCard).toContainText("-17.00");
  await expect(budgetCard.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(budgetCard.getByRole("progressbar")).toHaveAttribute("aria-valuetext", /% used — over budget/);
  await expect(page.getByRole("article").filter({ hasText: "Food & Drink" })).toContainText(
    "25.00",
  );

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Budget amount").fill("125.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Food & Drink" })).toContainText(
    "125.00",
  );
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("heading", { name: "No budgets this month" })).toBeVisible();

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
  await chooseOption(page, "Wallet", `${user.walletName} — USD`);
  await chooseOption(page, "Category", "Food & Drink");
  await page.getByLabel("Amount").fill("15.00");
  await chooseOption(page, "Frequency", "Weekly");
  await page.getByLabel("Start date").fill("2030-01-02");
  const recurringNote = `Weekly lunch ${user.email}`;
  await page.getByLabel("Note").fill(recurringNote);
  await page.getByRole("button", { name: "Create recurring rule" }).click();

  const recurringCard = page.getByRole("article").filter({ hasText: recurringNote });
  await expect(recurringCard).toContainText("Active");
  await expectOrdinaryUnchanged();
  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Amount").fill("18.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(recurringCard).toContainText("18.00");
  await expectOrdinaryUnchanged();
  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("status")).toContainText("Recurring rule paused");
  await expect(recurringCard).toContainText("Paused");
  await expectOrdinaryUnchanged();
  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("status")).toContainText("Recurring rule resumed");
  await expect(recurringCard).toContainText("Active");
  await expectOrdinaryUnchanged();
  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm delete" }).click();
});
