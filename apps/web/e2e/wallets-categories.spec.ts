import { expect, test } from "./support/test";
import type { Page } from "@playwright/test";
import { provisionUser } from "./support/auth";

async function chooseOption(page: Page, label: string, option: string) {
  const combobox = page.getByRole("combobox", { name: label, exact: true });
  await expect(combobox).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await combobox.click();
    const choice = page
      .locator('[data-slot="select-content"]:visible')
      .getByRole("option", { name: option, exact: true });
    await expect(choice).toBeVisible();
    try {
      await choice.click();
      await expect(page.locator('[data-slot="select-content"]:visible')).toHaveCount(0);
      await combobox.click();
      await expect(
        page
          .locator('[data-slot="select-content"]:visible')
          .getByRole("option", { name: option, exact: true, selected: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-slot="select-content"]:visible')).toHaveCount(0);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Element is not attached to the DOM") || attempt === 2) {
        throw error;
      }
      await page.keyboard.press("Escape");
    }
  }
}

async function waitForBudgetFormReady(page: Page) {
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
  await expect(page.getByText("Loading budget options…")).toHaveCount(0);
  await expect(page.getByText("Could not load budget options.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry budget options" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create budget" })).toBeVisible();
}

test("edits opening balance without changing history, then archives wallet with paused recurring rule", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = await provisionUser(page, "wallet-category");

  await page.goto("/app/transactions");
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Loading timezone…");

  // Create real financial activity first; opening-balance changes must not rewrite it.
  await page.goto("/app/transactions/new");
  await expect(page.getByRole("heading", { name: "New transaction", level: 1 })).toBeVisible();
  await page.getByLabel("Amount").fill("25.00");
  await page.getByLabel("Wallet").click();
  await page.getByRole("option", { name: `${user.walletName} — USD` }).click();
  await page.getByLabel("Category").click();
  await page.getByRole("option", { name: "Food & Drink" }).click();
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction saved");
  await page.goto("/app/transactions");
  const transactionRows = page.locator("article.transaction-row");
  await expect(transactionRows).toHaveCount(1);
  const transactionSnapshot = await transactionRows.first().innerText();

  const month = new Date().toISOString().slice(0, 7);
  await page.goto(`/app/budgets?month=${month}`);
  await waitForBudgetFormReady(page);
  await chooseOption(page, "Category", "Food & Drink");
  await chooseOption(page, "Currency", "USD — US Dollar");
  await page.getByLabel("Budget amount").fill("100.00");
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByRole("status")).toContainText("Budget saved");

  await page.goto("/app/recurring");
  await page.getByRole("button", { name: "New recurring rule" }).click();
  await chooseOption(page, "Wallet", `${user.walletName} — USD`);
  await chooseOption(page, "Category", "Food & Drink");
  await page.getByLabel("Amount").fill("15.00");
  await chooseOption(page, "Frequency", "Weekly");
  await page.getByLabel("Start date").fill(new Date().toISOString().slice(0, 10));
  const recurringNote = `Wallet archive rule ${user.email}`;
  await page.getByLabel("Note").fill(recurringNote);
  await page.getByRole("button", { name: "Create recurring rule" }).click();
  const recurringCard = page.getByRole("article").filter({ hasText: recurringNote });
  await expect(recurringCard).toContainText("Active");

  await page.goto(`/app?month=${month}`);
  const monthlySummary = page.locator('section[aria-labelledby="monthly-heading"]');
  const budgetSnapshot = page.locator('section[aria-labelledby="budget-heading"]');
  await expect(monthlySummary).toContainText("Expense");
  await expect(monthlySummary).toContainText("25.00");
  await expect(budgetSnapshot).toContainText("100.00");
  const financialSnapshotBefore = `${await monthlySummary.innerText()}\n${await budgetSnapshot.innerText()}`;

  await page.goto("/app/wallets");
  const wallet = page.getByRole("article").filter({ hasText: user.walletName });
  await expect(wallet).toContainText("USD 975.00");
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Edit wallet" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Wallet name")).toBeFocused();
  await expect(page.getByLabel("Currency")).toBeDisabled();
  await page.getByLabel("Opening balance").fill("1250.00");
  await page.getByRole("button", { name: "Save wallet" }).click();
  await expect(wallet).toContainText("USD 1,225.00");
  await expect(wallet.getByRole("button", { name: `Actions for ${user.walletName}` })).toBeFocused();
  await page.goto("/app/transactions");
  await expect(transactionRows).toHaveCount(1);
  await expect.poll(() => transactionRows.first().innerText()).toBe(transactionSnapshot);
  await page.goto(`/app?month=${month}`);
  await expect.poll(async () => `${await monthlySummary.innerText()}\n${await budgetSnapshot.innerText()}`).toBe(financialSnapshotBefore);

  await page.goto("/app/wallets");
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Edit wallet" }).click();
  await page.keyboard.press("Escape");
  await expect(wallet.getByRole("button", { name: `Actions for ${user.walletName}` })).toBeFocused();
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Edit wallet" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(wallet.getByRole("button", { name: `Actions for ${user.walletName}` })).toBeFocused();
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Edit wallet" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(wallet.getByRole("button", { name: `Actions for ${user.walletName}` })).toBeFocused();
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("dialog")).toContainText("pauses dependent recurring rules");
  await page.getByRole("button", { name: "Archive wallet" }).click();
  await expect(page.getByRole("status")).toContainText("Wallet archived");
  await expect(page).toHaveURL(/\/app\/wallets$/);
  await expect(wallet).toContainText("Archived");

  await page.goto("/app/recurring");
  await expect(page.getByRole("article").filter({ hasText: recurringNote })).toContainText("Paused");
  await page.goto("/app/transactions");
  await expect(transactionRows).toHaveCount(1);
  await expect.poll(() => transactionRows.first().innerText()).toBe(transactionSnapshot);
  await page.goto(`/app?month=${month}`);
  await expect.poll(async () => `${await monthlySummary.innerText()}\n${await budgetSnapshot.innerText()}`).toBe(financialSnapshotBefore);

  await page.goto("/app/wallets");
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toContainText("stay paused until you resume");
  await page.goto("/app/recurring");
  await expect(page.getByRole("article").filter({ hasText: recurringNote })).toContainText("Paused");
  await page.goto("/app/transactions");
  await expect(transactionRows).toHaveCount(1);
  await expect.poll(() => transactionRows.first().innerText()).toBe(transactionSnapshot);
  await page.goto(`/app?month=${month}`);
  await expect.poll(async () => `${await monthlySummary.innerText()}\n${await budgetSnapshot.innerText()}`).toBe(financialSnapshotBefore);
});

test("category management keeps archived labels out of active choices", async ({ page }) => {
  await provisionUser(page, "category-filter");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/categories");
  await expect(page.getByRole("tab", { name: "Expense" })).toHaveAttribute("aria-selected", "true");
  const expenseTab = page.getByRole("tab", { name: "Expense" });
  await expenseTab.focus();
  await expenseTab.press("ArrowRight");
  const incomeTab = page.getByRole("tab", { name: "Income" });
  await expect(incomeTab).toBeFocused();
  await incomeTab.press("Enter");
  await expect(incomeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Income" })).toBeVisible();
  await expenseTab.click();
  await expect(page.getByRole("button", { name: "Create category" }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel("Show archived")).not.toBeChecked();
  await page.getByRole("button", { name: "Create category" }).first().click();
  await expect(page.getByLabel("Category name")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Create category" }).first()).toBeFocused();
  await page.getByRole("button", { name: "Create category" }).first().click();
  await page.getByLabel("Category name").fill("Temporary category");
  await page.getByRole("button", { name: "Create category" }).last().click();
  await expect(page.getByRole("dialog", { name: "Create category" })).toBeHidden();
  const category = page.getByRole("article").filter({ hasText: "Temporary category" });
  await expect(category).toBeVisible();
  await category.getByRole("button", { name: "Actions for Temporary category" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive category" }).click();
  await expect(page.getByRole("status")).toContainText("Category archived");
  await expect(page.getByText("Temporary category")).toBeHidden();
  const archivedToggle = page.getByLabel("Show archived");
  await archivedToggle.focus();
  await archivedToggle.press("Space");
  await expect(archivedToggle).toBeChecked();
  await expect(page.getByText("Temporary category")).toBeVisible();
  await category.getByRole("button", { name: "Actions for Temporary category" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete forever" })).toBeVisible();
  await page.keyboard.press("Escape");
});
