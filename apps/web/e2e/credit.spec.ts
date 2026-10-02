import { expect, gotoHome, openNewMemo, test } from "./helpers";

test("credit: a limit/due day, an installment purchase, the plan and the limit bar", async ({ page, api, isMobile }) => {
  await api.signup();
  const visa = await api.source({
    name: "Visa",
    kind: "credit",
    emoji: "💳",
    track_balance: true,
    currency: "USD",
    opening_minor: 0,
    credit_limit_minor: 100_000,
    due_day: 15,
  });
  void visa; // selected by chip in the editor below

  await gotoHome(page);
  // A 3x installment purchase, paid with the credit card.
  const dialog = await openNewMemo(page, isMobile);
  await dialog.getByLabel("Amount").fill("120");
  await dialog.getByRole("group", { name: "Paid with" }).getByRole("button", { name: /Visa/ }).click();
  await dialog.getByRole("switch", { name: "Pay in installments" }).click();
  // Installments hide the attachment field (nothing to attach to N separate memos).
  await expect(dialog.getByText("Attachment")).toHaveCount(0);
  await dialog.getByRole("button", { name: "3×" }).click();
  await dialog.getByPlaceholder("What was it for?").fill("New TV");
  await dialog.getByRole("button", { name: "Save expense" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Split into 3 payments")).toBeVisible();

  // The plan shows under the source on the Sources page, split into equal monthly amounts.
  await page.goto("/manage?tab=sources");
  await expect(page.getByTestId("source-row").filter({ hasText: "Visa" })).toBeVisible();
  const plan = page.getByTestId("plan-row").filter({ hasText: "New TV" });
  await expect(plan).toBeVisible();
  await expect(plan).toContainText("/3");
  await expect(plan).toContainText("$40.00/mo");

  // The Home balances card shows the credit limit bar and headroom for a source with a limit.
  await gotoHome(page);
  const balances = page.getByTestId("balances-card");
  const visaRow = balances.getByTestId("balance-row").filter({ hasText: "Visa" });
  await expect(visaRow).toContainText("Available");
});
