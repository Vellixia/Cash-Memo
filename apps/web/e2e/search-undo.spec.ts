import { expect, gotoHome, test } from "./helpers";

test("search finds a memo from another month and opens it", async ({ page, api }) => {
  await api.signup();
  await api.memo({ direction: "expense", amount_minor: 4200, occurred_at: "2025-02-10T12:00:00Z", note: "Dentist visit" });
  await api.memo({ direction: "expense", amount_minor: 100, note: "Coffee" });

  await page.goto("/search?q=dentist");
  const rows = page.getByTestId("memo-row");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Dentist visit");
  await rows.click();
  await expect(page.getByTestId("memo-editor")).toBeVisible();
});

test("keyboard: n opens the editor, / goes to search", async ({ page, api, isMobile }) => {
  test.skip(isMobile, "desktop shortcuts");
  await api.signup();
  await gotoHome(page);
  await page.keyboard.press("n");
  await expect(page.getByTestId("memo-editor")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("memo-editor")).toBeHidden();
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/\/search/);
});

test("undo a memo delete and a source archive", async ({ page, api }) => {
  await api.signup();
  await api.memo({ direction: "expense", amount_minor: 900, note: "Taxi home" });
  await api.source({ name: "GoPay", kind: "ewallet" });

  await gotoHome(page);
  await page.getByTestId("memo-row").filter({ hasText: "Taxi home" }).click();
  const editor = page.getByTestId("memo-editor");
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete memo" }).click();
  await expect(page.getByTestId("memo-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("memo-row").filter({ hasText: "Taxi home" })).toBeVisible();

  await page.goto("/sources");
  await page.getByRole("button", { name: "Archive GoPay" }).click();
  await page.getByRole("button", { name: "Archive source" }).click();
  await expect(page.getByText("Source archived")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Restored “GoPay”/)).toBeVisible();
});
