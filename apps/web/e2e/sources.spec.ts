import { expect, gotoHome, openNewMemo, test } from "./helpers";

test("sources: paying with a card, a transfer, balances, filtering and archiving", async ({ page, api, isMobile }) => {
  await api.signup();
  const bca = await api.source({ name: "BCA", kind: "bank", emoji: "🏦", track_balance: true, currency: "USD", opening_minor: 100_000 });
  const visa = await api.source({ name: "Visa", kind: "credit", emoji: "💳", track_balance: true, currency: "USD", opening_minor: 0 });
  void visa; // selected by chip in the UI below
  await api.memo({ direction: "expense", amount_minor: 1000, currency: "USD", source_id: bca.id, note: "Coffee run" });

  await gotoHome(page);
  await expect(page.getByTestId("memo-row")).toHaveCount(1);

  // Pay an expense with the credit card.
  const dialog = await openNewMemo(page, isMobile);
  await dialog.getByLabel("Amount").fill("40");
  await dialog.getByRole("group", { name: "Paid with" }).getByRole("button", { name: /Visa/ }).click();
  await dialog.getByPlaceholder("What was it for?").fill("Groceries");
  await dialog.getByRole("button", { name: "Save expense" }).click();
  await expect(dialog).toBeHidden();

  const groceries = page.getByTestId("memo-row").filter({ hasText: "Groceries" });
  await expect(groceries).toContainText("Visa");
  await expect(groceries).toContainText("−$40.00");

  // A transfer, paying down the card from the bank account.
  const dialog2 = await openNewMemo(page, isMobile);
  await dialog2.getByRole("radio", { name: "Transfer" }).click();
  await dialog2.getByLabel("Amount").fill("25");
  await dialog2.getByRole("group", { name: "From account" }).getByRole("button", { name: /BCA/ }).click();
  await dialog2.getByRole("group", { name: "To account" }).getByRole("button", { name: /Visa/ }).click();
  await dialog2.getByPlaceholder("What was it for?").fill("Card payment");
  await dialog2.getByRole("button", { name: "Save transfer" }).click();
  await expect(dialog2).toBeHidden();

  // Transfer styling: neutral amount, no +/- sign, "From → To" subtitle.
  const transfer = page.getByTestId("memo-row").filter({ hasText: "Card payment" });
  await expect(transfer).toContainText("BCA → Visa");
  await expect(transfer).toContainText("$25.00");
  await expect(transfer).not.toContainText("+$25.00");
  await expect(transfer).not.toContainText("−$25.00");

  // A transfer never counts toward income/expense.
  await expect(page.getByTestId("hero-expense")).toHaveText("$50.00"); // 10 (coffee) + 40 (groceries)

  // Ledger subtitle: an expense's source shows even without a note-vs-category conflict.
  const coffee = page.getByTestId("memo-row").filter({ hasText: "Coffee run" });
  await expect(coffee).toContainText("BCA");

  // Balances card: BCA down by the coffee expense and the transfer out; Visa owed the net of the two.
  const balances = page.getByTestId("balances-card");
  await expect(balances).toBeVisible();
  await expect(balances.getByTestId("balance-row").filter({ hasText: "BCA" })).toContainText("$965.00");
  await expect(balances.getByTestId("balance-row").filter({ hasText: "Visa" })).toContainText("Owed $15.00");

  // Source filter matches both sides of the transfer.
  await page.getByRole("combobox", { name: "Filter by source" }).click();
  await page.getByRole("option", { name: /Visa/ }).click();
  await expect(page.getByTestId("memo-row")).toHaveCount(2);
  await expect(page.getByTestId("memo-row").filter({ hasText: "Coffee run" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Filter by source" }).click();
  await page.getByRole("option", { name: "All sources" }).click();
  await expect(page.getByTestId("memo-row")).toHaveCount(3);

  // Archive BCA from the Sources page.
  await page.goto("/sources");
  const bcaRow = page.getByTestId("source-row").filter({ hasText: "BCA" });
  await expect(bcaRow).toContainText("$965.00");
  await bcaRow.getByRole("button", { name: "Archive BCA" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive source" }).click();
  await expect(page.getByText("Source archived")).toBeVisible();
  await expect(page.getByTestId("source-row").filter({ hasText: "BCA" })).toHaveCount(0);
  const archived = page.getByRole("button", { name: "Archived (1)" });
  await expect(archived).toBeVisible();
  await archived.click();
  await expect(page.getByTestId("source-row").filter({ hasText: "BCA" })).toBeVisible();

  // An archived source no longer offers itself as a chip in the memo editor.
  await gotoHome(page);
  const dialog3 = await openNewMemo(page, isMobile);
  await expect(dialog3.getByRole("group", { name: "Paid with" }).getByRole("button", { name: /BCA/ })).toHaveCount(0);
  await expect(dialog3.getByRole("group", { name: "Paid with" }).getByRole("button", { name: /Visa/ })).toBeVisible();
  await page.keyboard.press("Escape");
});
