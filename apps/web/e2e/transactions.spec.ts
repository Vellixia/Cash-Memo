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

test("round trips local transaction minute across browser and profile timezones", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  try {
    await provisionUser(page, "transaction-timezone", "Asia/Jakarta");
    await page.goto("/app/transactions/new");
    await page.getByLabel("Amount").fill("12.34");
    await page.getByRole("combobox", { name: "Category" }).click();
    await page.getByRole("option", { name: "Food & Drink", exact: true }).click();
    await page.getByLabel("Occurred at").fill("2026-08-31T23:30");
    const delivered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/transactions",
    );
    await page.getByRole("button", { name: "Save transaction" }).click();
    const response = await delivered;
    const created = (await response.json()) as { id: string; occurred_at: string };
    expect(created).toMatchObject({
      occurred_at: "2026-08-31T16:30:00Z",
    });
    await page.goto(`/app/transactions/${created.id}/edit`);
    await expect(page.getByLabel("Occurred at")).toHaveValue("2026-08-31T23:30");
  } finally {
    await context.close();
  }
});
