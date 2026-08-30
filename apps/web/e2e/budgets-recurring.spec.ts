import { expect, test } from "./support/test";
import { apiUrl } from "./support/api";
import { provisionUser } from "./support/auth";
import { inspectGeneratedLinkage, processRecurring } from "./support/process-recurring";
import type { Page } from "@playwright/test";

interface BrowserTransaction {
  id: string;
  wallet_id: string;
  category_id: string;
  direction: string;
  amount: string;
  currency: string;
  occurred_at: string;
  note?: string | null;
}

async function listTransactions(page: Page): Promise<BrowserTransaction[]> {
  const response = await page.request.get(apiUrl("/api/v1/transactions?limit=100"));
  if (!response.ok()) throw new Error(`Could not list transactions: ${String(response.status())}`);
  const body = (await response.json()) as { items?: BrowserTransaction[] };
  return body.items ?? [];
}

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
  await page.getByLabel("Amount").fill("42.00");
  await chooseOption(page, "Frequency", "Daily");
  await page.getByLabel("Start date").fill("2000-01-01");
  const ordinaryNote = `Generated ordinary memo ${user.email}`;
  await page.getByLabel("Note").fill(ordinaryNote);
  await page.getByRole("button", { name: "Create recurring rule" }).click();

  const recurringCard = page.getByRole("article").filter({ hasText: ordinaryNote });
  await expect(recurringCard).toContainText("Active");
  const processor = processRecurring();
  expect(processor).toEqual({ command: "process-recurring", processed: 1 });
  const generated = (await listTransactions(page)).filter((item) => item.note === ordinaryNote);
  expect(generated, "processor must create one ordinary transaction").toHaveLength(1);
  const generatedTransaction = generated[0];
  expect(inspectGeneratedLinkage(ordinaryNote)).toEqual({
    rows: 1,
    linkedRows: 1,
    distinctOccurrences: 1,
  });
  const generatedSnapshot = {
    id: generatedTransaction.id,
    wallet_id: generatedTransaction.wallet_id,
    category_id: generatedTransaction.category_id,
    direction: generatedTransaction.direction,
    amount: generatedTransaction.amount,
    currency: generatedTransaction.currency,
    occurred_at: generatedTransaction.occurred_at,
    note: generatedTransaction.note,
  };
  async function expectGeneratedUnchanged() {
    const matching = (await listTransactions(page)).filter((item) => item.note === ordinaryNote);
    expect(matching, "generated transaction must not duplicate").toHaveLength(1);
    const current = matching[0];
    expect({
      id: current.id,
      wallet_id: current.wallet_id,
      category_id: current.category_id,
      direction: current.direction,
      amount: current.amount,
      currency: current.currency,
      occurred_at: current.occurred_at,
      note: current.note,
    }).toEqual(generatedSnapshot);
  }

  await page.goto("/app/budgets");
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New budget", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Month", { exact: true })).not.toHaveValue("");
  await chooseOption(page, "Category", "Food & Drink");
  await chooseOption(page, "Currency", "USD — US Dollar");
  await page.getByLabel("Budget amount").fill("25.00");
  const budgetMonth = await page.getByLabel("Month", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByRole("status")).toContainText("Budget saved");
  await expectGeneratedUnchanged();
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
  const budgetsAfterDeleteResponse = await page.request.get(
    apiUrl(`/api/v1/budgets?month=${encodeURIComponent(budgetMonth)}`),
  );
  if (!budgetsAfterDeleteResponse.ok()) {
    throw new Error(`Could not list budgets: ${String(budgetsAfterDeleteResponse.status())}`);
  }
  const budgetsAfterDelete = (await budgetsAfterDeleteResponse.json()) as unknown[];
  expect(budgetsAfterDelete, "confirmed budget delete must remove server record").toHaveLength(0);
  await expectGeneratedUnchanged();

  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Amount").fill("18.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(recurringCard).toContainText("18.00");
  await expectGeneratedUnchanged();
  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("status")).toContainText("Recurring rule paused");
  await expect(recurringCard).toContainText("Paused");
  await expectGeneratedUnchanged();
  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("status")).toContainText("Recurring rule resumed");
  await expect(recurringCard).toContainText("Active");
  await expectGeneratedUnchanged();
  await page.goto("/app/recurring");
  await recurringCard.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm delete" }).click();
});
