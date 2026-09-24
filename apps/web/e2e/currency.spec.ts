import { expect, gotoHome, noHorizontalOverflow, openNewMemo, test } from "./helpers";
import type { Page } from "@playwright/test";

test("an IDR memo reads natively: Rp 75.000", async ({ page, api, user }) => {
  void user;
  await api.memo({ direction: "expense", amount_minor: 75000, currency: "IDR", note: "Nasi goreng" });
  await gotoHome(page);
  await expect(page.getByTestId("memo-row").filter({ hasText: "Nasi goreng" })).toContainText("−Rp 75.000");
  await expect(page.getByTestId("hero-expense")).toHaveText("Rp 75.000");
});

test("picking IDR, typing 75000 shows 75.000 and saves 75000 minor units", async ({ page, user, isMobile }) => {
  void user;
  await gotoHome(page);
  const dialog = await openNewMemo(page, isMobile);
  await dialog.getByRole("button", { name: /Currency USD/ }).click();
  const picker = page.getByTestId("currency-picker");
  const search = picker.getByRole("combobox", { name: "Search currencies" });
  await expect(search).toBeFocused();
  await search.fill("rupiah");
  await expect(picker.getByRole("option").first()).toContainText("Indonesian Rupiah");
  await search.press("Enter");
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();

  const amount = dialog.getByLabel("Amount");
  await expect(amount).toHaveAttribute("placeholder", "0");
  await amount.click();
  await amount.pressSequentially("75000");
  await expect(amount).toHaveValue("75.000");

  const created = page.waitForRequest((r) => r.url().endsWith("/api/memos") && r.method() === "POST");
  await dialog.getByRole("button", { name: "Save expense" }).click();
  expect((await created).postDataJSON()).toMatchObject({ amount_minor: 75000, currency: "IDR" });
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("hero-expense")).toHaveText("Rp 75.000");

  // IDR is now under "Recent" in the picker.
  await openNewMemo(page, isMobile);
  await page.getByTestId("memo-editor").getByRole("button", { name: /Currency USD/ }).click();
  await expect(picker.getByRole("group", { name: "Recent" }).getByRole("option")).toHaveText([/IDR/]);
});

test("amount field groups USD natively and keeps typing at the caret", async ({ page, user, isMobile }) => {
  void user;
  await gotoHome(page);
  const dialog = await openNewMemo(page, isMobile);
  const amount = dialog.getByLabel("Amount");
  await amount.pressSequentially("1234.567");
  await expect(amount).toHaveValue("1,234.56");
  // Put the caret after "1" and type: grouping follows, the caret stays after the typed digit.
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 1));
  await amount.pressSequentially("9");
  await expect(amount).toHaveValue("19,234.56");
  expect(await amount.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(2);
  // Backspace over the group separator removes the digit before it.
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3));
  await amount.press("Backspace");
  await expect(amount).toHaveValue("1,234.56");
});

test("currency picker: Default/All sections, keyboard, Escape closes only the picker", async ({ page, user, isMobile }) => {
  void user;
  await gotoHome(page);
  const dialog = await openNewMemo(page, isMobile);
  await dialog.getByRole("button", { name: /Currency USD/ }).click();
  const picker = page.getByTestId("currency-picker");
  await expect(picker.getByRole("group", { name: "Default" }).getByRole("option")).toHaveText([/USD.*US Dollar/]);
  await expect(picker.getByRole("group", { name: "All" }).getByRole("option", { name: /Euro/ })).toBeVisible();
  const search = picker.getByRole("combobox", { name: "Search currencies" });
  await expect(picker.getByRole("option", { selected: true }).first()).toContainText("USD");

  await search.fill("dollar");
  const first = picker.getByRole("option").first();
  await expect(first).toContainText("Dollar");
  await expect(search).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
  await search.press("ArrowDown");
  await expect(search).not.toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
  await search.fill("zzzz");
  await expect(picker.getByText("No currency matches")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Currency USD/ })).toBeVisible();
});

test("changing the default currency on Account makes the next new memo start in it", async ({ page, user, isMobile }) => {
  void user;
  await page.goto("/account");
  await expect(page.getByTestId("default-currency-name")).toHaveText("US Dollar");
  await page.getByRole("button", { name: /Default currency USD/ }).click();
  const picker = page.getByTestId("currency-picker");
  await picker.getByRole("combobox", { name: "Search currencies" }).fill("yen");
  await picker.getByRole("option", { name: /Japanese Yen/ }).click();
  await expect(page.getByTestId("default-currency-name")).toHaveText("Japanese Yen");
  await expect(page.getByText("New memos will start in JPY")).toBeVisible();
  await page.reload(); // saved on the server
  await expect(page.getByTestId("default-currency-name")).toHaveText("Japanese Yen");

  await gotoHome(page);
  const dialog = await openNewMemo(page, isMobile);
  await expect(dialog.getByRole("button", { name: /Currency JPY/ })).toBeVisible();
  await dialog.getByLabel("Amount").fill("1200");
  await expect(dialog.getByLabel("Amount")).toHaveValue("1,200");
});

test("a month with several currencies shows the All currencies card, default first", async ({ page, api, user }) => {
  void user;
  await api.memo({ direction: "expense", amount_minor: 1500, currency: "USD" });
  await gotoHome(page);
  await expect(page.getByTestId("currencies-card")).toHaveCount(0);

  await api.memo({ direction: "income", amount_minor: 7_500_000, currency: "IDR" });
  await api.memo({ direction: "expense", amount_minor: 4000, currency: "EUR" });
  await page.reload();
  const rows = page.getByTestId("currencies-card").getByTestId("currency-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("USD");
  await expect(rows.filter({ hasText: "IDR" })).toContainText("+Rp 7.500.000");
  await expect(rows.filter({ hasText: "EUR" })).toContainText("−40,00 €");
  await expect(rows.filter({ hasText: "USD" })).toContainText("−$15.00");
  // The default currency leads the hero switcher and is selected.
  const switcher = page.getByRole("radiogroup", { name: "Currency" });
  await expect(switcher.getByRole("radio").first()).toHaveAccessibleName("USD");
  await expect(switcher.getByRole("radio", { name: "USD" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("hero-expense")).toHaveText("$15.00");
  await noHorizontalOverflow(page);
});

/** Fakes the browser's install offer; `prompt()` just counts calls. */
async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __prompted: number };
    w.__prompted = 0;
    const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        w.__prompted++;
      },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(e);
  });
}
const prompted = (page: Page) => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted);

test("install entry: hidden with no prompt, appears on beforeinstallprompt and calls prompt()", async ({ page, user, isMobile }) => {
  void user;
  if (!isMobile) {
    await gotoHome(page);
    const menu = page.getByRole("button", { name: "Account menu" });
    await menu.click();
    await expect(page.getByRole("menuitem", { name: /Account/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Install app" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await offerInstall(page);
    await menu.click();
    await page.getByRole("menuitem", { name: "Install app" }).click();
    await expect.poll(() => prompted(page)).toBe(1);
    await menu.click();
    await expect(page.getByRole("menuitem", { name: /Account/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Install app" })).toHaveCount(0); // a prompt is single-use
    await page.keyboard.press("Escape");
  }

  await page.goto("/account");
  await expect(page.getByTestId("default-currency-name")).toBeVisible();
  const install = page.getByRole("button", { name: "Install app" });
  await expect(install).toHaveCount(0);
  await offerInstall(page);
  await install.click();
  await expect.poll(() => prompted(page)).toBe(1);
  await expect(install).toHaveCount(0);
  // No popups: nothing but the quiet entry ever appeared.
  await expect(page.getByText(/Install Cash Memo/)).toHaveCount(0);
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });

  test("the Account page shows the Add to Home Screen hint instead of a button", async ({ page, user }) => {
    void user;
    await page.goto("/account");
    await expect(page.getByTestId("ios-install-hint")).toContainText("Add to Home Screen");
    await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
  });
});
