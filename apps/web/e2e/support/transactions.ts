import { expect, type Page } from "@playwright/test";

export interface TransactionInput {
  amount: string;
  category: string;
  direction: "expense" | "income";
  note: string;
}

export async function createTransaction(page: Page, input: TransactionInput): Promise<string> {
  await page.goto("/app/transactions/new");
  await page.getByLabel("Amount").fill(input.amount);
  await page.getByRole("radio", { name: input.direction === "income" ? "Income" : "Expense" }).click();
  await expect(page.getByRole("combobox", { name: "Wallet" })).not.toHaveText("Choose wallet");
  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: input.category, exact: true }).click();
  await page.getByLabel("Note").fill(input.note);
  const delivered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/transactions",
  );
  await page.getByRole("button", { name: "Save transaction" }).click();
  const response = await delivered;
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { id: string };
  await expect(page.getByRole("status")).toContainText("Transaction saved");
  return created.id;
}
