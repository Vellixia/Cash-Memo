import { expect, gotoHome, openNewMemo, showCategories, test } from "./helpers";

test("a monthly memo shows next month as upcoming; a budget shows its bar", async ({ page, api, user, isMobile }) => {
  void user;
  await api.category("Rent", "expense", "🏠");

  // Budget from the Categories page.
  await page.goto("/categories");
  const expense = await showCategories(page, "expense");
  await expense.getByRole("button", { name: "Budget for Rent" }).click();
  await expense.getByLabel("Monthly budget for Rent (USD)").fill("100");
  await expense.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget set for “Rent”")).toBeVisible();
  await expect(expense.getByText("Budget $100.00 a month")).toBeVisible();

  // A monthly expense from the editor.
  await gotoHome(page);
  const dialog = await openNewMemo(page, isMobile);
  await dialog.getByLabel("Amount").fill("12.50");
  await dialog.getByRole("button", { name: /Rent/ }).click();
  await dialog.getByPlaceholder("What was it for?").fill("Flat rent");
  await dialog.getByRole("radiogroup", { name: "Repeat" }).getByRole("radio", { name: "Monthly" }).click();
  await dialog.getByRole("button", { name: "Save expense" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("memo-row").filter({ hasText: "Flat rent" })).toBeVisible();

  const bar = page.getByTestId("budgets-card").getByTestId("budget-row").filter({ hasText: "Rent" });
  await expect(bar).toContainText("$12.50 / $100.00");
  await expect(bar.getByRole("progressbar", { name: "Rent budget" })).toHaveAttribute("aria-valuenow", "13");

  // Next month: the occurrence is upcoming, muted and out of the totals.
  await page.getByRole("button", { name: "Next month" }).click();
  const upcoming = page.getByTestId("upcoming-row").filter({ hasText: "Flat rent" });
  await expect(upcoming).toContainText("Upcoming");
  await expect(upcoming).toContainText("−$12.50");
  await expect(page.getByTestId("hero-net")).not.toContainText("12.50");

  // The memo links to its rule; the rule can be paused from /recurring.
  await page.getByRole("button", { name: "Previous month" }).click();
  await page.getByTestId("memo-row").filter({ hasText: "Flat rent" }).click();
  await page.getByTestId("memo-editor").getByRole("link", { name: /Manage/ }).click();
  await expect(page).toHaveURL(/\/recurring$/);
  const rule = page.getByTestId("rule-row").filter({ hasText: "Flat rent" });
  await expect(rule).toContainText("Monthly");
  await rule.getByRole("button", { name: "Pause Flat rent" }).click();
  await expect(rule).toContainText("Paused");
});
