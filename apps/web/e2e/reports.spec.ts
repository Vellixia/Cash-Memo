import { expect, test } from "./helpers";

test("reports: shows income vs expense for this month's memos", async ({ page, api }) => {
  await api.signup();
  await api.memo({ direction: "income", amount_minor: 500000, note: "Salary" });
  await api.memo({ direction: "expense", amount_minor: 1250, note: "Lunch" });

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Income vs expense" })).toBeVisible();

  const chart = page.getByRole("img", { name: "Income and expense per month" });
  await expect(chart).toBeVisible();
  await expect(chart.locator('[title*="$5,000.00"]')).toHaveCount(1);
  await expect(chart.locator('[title*="$12.50"]')).toHaveCount(1);

  await expect(page.getByRole("heading", { name: "Spending trend by category" })).toBeVisible();
});
