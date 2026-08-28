import { expect, test } from "./support/test";
import { provisionUser } from "./support/auth";

test("edits opening balance without history, then archives wallet with paused recurring rule", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = await provisionUser(page, "wallet-category");

  await page.goto("/app/transactions");
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Loading timezone…");
  const historyBefore = await page.getByRole("main").innerText();

  await page.goto("/app/wallets");
  const wallet = page.getByRole("article").filter({ hasText: user.walletName });
  await expect(wallet).toContainText("USD 1,000.00");
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Edit wallet" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Currency")).toBeDisabled();
  await page.getByLabel("Opening balance").fill("1250.00");
  await page.getByRole("button", { name: "Save wallet" }).click();
  await expect(wallet).toContainText("USD 1,250.00");

  await page.goto("/app/transactions");
  await expect(page.getByRole("main")).not.toContainText("Loading timezone…");
  await expect.poll(() => page.getByRole("main").innerText()).toBe(historyBefore);

  await page.goto("/app/wallets");
  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("dialog")).toContainText("pauses dependent recurring rules");
  await page.getByRole("button", { name: "Archive wallet" }).click();
  await expect(page.getByRole("status")).toContainText("Wallet archived");
  await expect(page).toHaveURL(/\/app\/wallets$/);
  await expect(wallet).toContainText("Archived");

  await wallet.getByRole("button", { name: `Actions for ${user.walletName}` }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toContainText("stay paused until you resume");
});

test("category management keeps archived labels out of active choices", async ({ page }) => {
  await provisionUser(page, "category-filter");
  await page.goto("/app/categories");
  await expect(page.getByRole("tab", { name: "Expense" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Show archived")).not.toBeChecked();
  await page.getByRole("button", { name: "Create category" }).first().click();
  await page.getByLabel("Category name").fill("Temporary category");
  await page.getByRole("button", { name: "Create category" }).last().click();
  await expect(page.getByRole("status")).toContainText("Category created");
  const category = page.getByRole("article").filter({ hasText: "Temporary category" });
  await category.getByRole("button", { name: "Actions for Temporary category" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive category" }).click();
  await expect(page.getByRole("status")).toContainText("Category archived");
  await expect(page.getByText("Temporary category")).toBeHidden();
  await page.getByLabel("Show archived").check();
  await expect(page.getByText("Temporary category")).toBeVisible();
});
