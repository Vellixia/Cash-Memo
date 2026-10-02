import { expect, gotoHome, openNewMemo, showCategories, test } from "./helpers";

test("a monthly memo shows next month as upcoming; a budget shows its bar", async ({ page, api, user, isMobile }) => {
  void user;
  await api.category("Rent", "expense", "🏠");

  // Budget (monthly limit) from the Categories tab.
  await page.goto("/manage?tab=categories");
  const expense = await showCategories(page, "expense");
  const rentRow = expense.getByTestId("category-row").filter({ hasText: "Rent" });
  await expect(rentRow.getByTestId("limit-status")).toHaveCount(0);
  await rentRow.getByRole("button", { name: "Actions for Rent" }).click();
  await page.getByRole("menuitem", { name: "Set monthly limit" }).click();
  const limitDialog = page.getByRole("dialog", { name: "Monthly limit for Rent" });
  await expect(limitDialog.getByRole("button", { name: "Remove limit" })).toHaveCount(0);
  await limitDialog.getByLabel("Monthly limit (USD)").fill("100");
  await limitDialog.getByRole("button", { name: "Save limit" }).click();
  await expect(page.getByText("Monthly limit set for “Rent”")).toBeVisible();
  await expect(limitDialog).toBeHidden();
  await expect(rentRow.getByTestId("limit-status")).toContainText("$0.00 of $100.00 this month");
  await expect(rentRow.getByTestId("limit-status")).toContainText("$100.00 remaining");

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

  // Back on the Categories tab: spent and remaining; then lower the limit below what's spent, and remove it.
  await page.goto("/manage?tab=categories");
  const status = (await showCategories(page, "expense")).getByTestId("category-row").filter({ hasText: "Rent" }).getByTestId("limit-status");
  await expect(status).toContainText("$12.50 of $100.00 this month");
  await expect(status).toContainText("$87.50 remaining");
  await expect(status.getByRole("progressbar", { name: "Rent monthly limit" })).toHaveAttribute("aria-valuenow", "13");
  await page.getByRole("button", { name: "Actions for Rent" }).click();
  await page.getByRole("menuitem", { name: "Edit monthly limit" }).click();
  await expect(limitDialog.getByLabel("Monthly limit (USD)")).toHaveValue("100.00");
  await limitDialog.getByLabel("Monthly limit (USD)").fill("10");
  await limitDialog.getByRole("button", { name: "Save limit" }).click();
  await expect(limitDialog).toBeHidden();
  await expect(status).toContainText("$2.50 over");
  // Cancel leaves it alone.
  await page.getByRole("button", { name: "Actions for Rent" }).click();
  await page.getByRole("menuitem", { name: "Edit monthly limit" }).click();
  await limitDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(limitDialog).toBeHidden();
  await expect(status).toContainText("of $10.00");
  await page.getByRole("button", { name: "Actions for Rent" }).click();
  await page.getByRole("menuitem", { name: "Edit monthly limit" }).click();
  await limitDialog.getByRole("button", { name: "Remove limit" }).click();
  await expect(page.getByText("Monthly limit removed from “Rent”")).toBeVisible();
  await expect(status).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for Rent" }).click();
  await expect(page.getByRole("menuitem", { name: "Set monthly limit" })).toBeVisible();
  await page.keyboard.press("Escape");
  await gotoHome(page);

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
