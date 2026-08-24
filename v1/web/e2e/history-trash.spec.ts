import { expect, test } from "@playwright/test";
import { provisionUser } from "./support/auth";
import { createTransaction } from "./support/transactions";

test("filters, edits, trashes, and restores one memo", async ({ page }) => {
  const user = await provisionUser(page, "history-trash");
  const originalNote = `Original ${user.email}`;
  const editedNote = `Edited ${user.email}`;
  await createTransaction(page, {
    amount: "21.00",
    category: "Food & Drink",
    direction: "expense",
    note: originalNote,
  });
  await createTransaction(page, {
    amount: "22.00",
    category: "Transport",
    direction: "expense",
    note: `Other ${user.email}`,
  });

  await page.goto("/app/transactions");
  await page.getByLabel("Search").fill(originalNote);
  await expect(page).toHaveURL(
    new RegExp(`q=${encodeURIComponent(originalNote).replaceAll("%20", "\\+")}`),
  );
  await expect(page.getByText(originalNote, { exact: true })).toBeVisible();
  await expect(page.getByText(`Other ${user.email}`, { exact: true })).toHaveCount(0);

  const originalCard = page.getByRole("article").filter({ hasText: originalNote });
  await originalCard.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Amount").fill("23.50");
  await page.getByLabel("Note").fill(editedNote);
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction saved");

  await page.goto(`/app/transactions?q=${encodeURIComponent(editedNote)}`);
  const editedCard = page.getByRole("article").filter({ hasText: editedNote });
  await expect(editedCard).toBeVisible();
  await editedCard.getByRole("button", { name: "Delete" }).click();
  await editedCard.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("status")).toContainText("moved to Trash");
  await expect(editedCard).toHaveCount(0);

  await page.goto("/app/transactions/trash");
  const trashedCard = page.getByRole("article").filter({ hasText: "23.50 USD" });
  await expect(trashedCard).toBeVisible();
  await trashedCard.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction restored");
  await expect(trashedCard).toHaveCount(0);

  await page.goto(`/app/transactions?q=${encodeURIComponent(editedNote)}`);
  await expect(page.getByText(editedNote, { exact: true })).toBeVisible();
});
