import { expect, test } from "./support/test";
import { provisionUser } from "./support/auth";
import { createTransaction } from "./support/transactions";

test("records isolated expense and income memos", async ({ page }) => {
  const user = await provisionUser(page, "transactions");
  const expenseNote = `Coffee ${user.email}`;
  const incomeNote = `Salary ${user.email}`;

  await createTransaction(page, {
    amount: "12.34",
    category: "Food & Drink",
    direction: "expense",
    note: expenseNote,
  });
  await createTransaction(page, {
    amount: "250.00",
    category: "Salary",
    direction: "income",
    note: incomeNote,
  });

  await page.goto("/app/transactions");
  await expect(page.getByText(expenseNote, { exact: true })).toBeVisible();
  await expect(page.getByText(incomeNote, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Expense 12\.34 USD/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Income 250\.00 USD/ })).toBeVisible();
});
