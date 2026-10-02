import { expect, gotoHome, noHorizontalOverflow, openNewMemo, test } from "./helpers";
import type { Locator, Page } from "@playwright/test";

const CATEGORIES = ["Groceries", "Rent", "Utilities", "Transport", "Dining", "Coffee", "Gym", "Books", "Movies", "Travel", "Gifts", "Health", "Pets", "Phone", "Internet"];
const SOURCES = ["BCA", "Mandiri", "BNI", "Jago", "GoPay", "OVO", "Dana", "ShopeePay", "Wise", "Payoneer", "Revolut", "Amex", "Mastercard", "Kredivo", "Akulaku"];

/** The chips a group shows inline (its toggle buttons; "More…" and "New" aren't toggles). */
const inlineChips = (group: Locator) => group.locator("button[aria-pressed]");

/** The editor's scroll area never scrolls sideways: no child is wider than it (overflow-x-hidden would only mask that). */
async function editorFits(page: Page) {
  const body = page.getByTestId("memo-editor-body");
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth), "memo editor body scrolls sideways").toBeLessThanOrEqual(0);
  await noHorizontalOverflow(page);
}

/** A group's "More…" picker is titled like the group (a just-closed one may still be animating out). */
const pickerFor = (page: Page, group: string) => page.getByRole("dialog", { name: group });

async function pickFromMore(page: Page, dialog: Locator, group: string, moreLabel: string, search: string, option: string) {
  await dialog.getByRole("group", { name: group }).getByRole("button", { name: moreLabel }).click();
  const picker = pickerFor(page, group);
  await expect(picker).toBeVisible();
  const input = picker.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill(search);
  await expect(picker.getByRole("option")).toHaveCount(1);
  await picker.getByRole("option", { name: option }).click();
  await expect(picker).toBeHidden();
}

test("large category and source lists: a few chips inline, the rest in a searchable picker", async ({ page, api, isMobile }) => {
  await api.signup();
  for (const name of CATEGORIES) await api.category(name, "expense");
  await api.category("Salary", "income", "💼");
  for (const name of SOURCES) await api.source({ name, kind: "bank" });
  await api.source({ name: "Rupiah wallet", kind: "ewallet", currency: "IDR" });
  await gotoHome(page);

  const dialog = await openNewMemo(page, isMobile);
  const categories = dialog.getByRole("group", { name: "Categories" });
  const paidWith = dialog.getByRole("group", { name: "Paid with" });
  // The form stays compact: a handful of chips each, plus More… and New.
  await expect(inlineChips(categories)).toHaveCount(5);
  await expect(inlineChips(paidWith)).toHaveCount(5);
  await expect(categories.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(paidWith.getByRole("link", { name: "Add new source" })).toBeVisible();
  await editorFits(page);

  // The picker lists every expense category (and no income ones); search narrows it.
  await categories.getByRole("button", { name: "More categories" }).click();
  let picker = pickerFor(page, "Categories");
  await expect(picker.getByRole("option")).toHaveCount(CATEGORIES.length);
  await expect(picker.getByRole("option", { name: "Salary" })).toHaveCount(0);
  await picker.getByRole("combobox").fill("zzz");
  await expect(picker.getByText("Nothing matches “zzz”.")).toBeVisible();
  // Escape closes only the picker.
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();

  // Picking from the full list keeps the choice visible (and selected) among the inline chips.
  await pickFromMore(page, dialog, "Categories", "More categories", "pet", "Pets");
  await expect(categories.getByRole("button", { name: "Pets" })).toHaveAttribute("aria-pressed", "true");
  await expect(inlineChips(categories)).toHaveCount(5);

  // Keyboard: arrows + Enter pick from the filtered list.
  await paidWith.getByRole("button", { name: "More sources" }).click();
  picker = pickerFor(page, "Paid with");
  await expect(picker.getByRole("option")).toHaveCount(SOURCES.length + 2); // + the default Cash + Rupiah wallet
  await picker.getByRole("combobox").fill("pay");
  await expect(picker.getByRole("option")).toHaveCount(3); // GoPay, ShopeePay, Payoneer
  const second = (await picker.getByRole("option").allInnerTexts())[1].trim();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await expect(paidWith.getByRole("button", { name: second })).toHaveAttribute("aria-pressed", "true");

  // A source with a fixed currency picked from the picker still locks the memo's currency.
  await pickFromMore(page, dialog, "Paid with", "More sources", "rupiah", "Rupiah wallet");
  await expect(paidWith.getByRole("button", { name: "Rupiah wallet" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByText("Currency locked to IDR by Rupiah wallet")).toBeVisible();
  await editorFits(page);

  await dialog.getByLabel("Amount").fill("15000");
  await dialog.getByPlaceholder("What was it for?").fill("Cat food");
  await dialog.getByRole("button", { name: "Save expense" }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByTestId("memo-row").filter({ hasText: "Cat food" });
  await expect(row).toContainText("Pets");
  await expect(row).toContainText("Rupiah wallet");

  // Income only offers income categories, and a short list has no More….
  const dialog2 = await openNewMemo(page, isMobile);
  await dialog2.getByRole("radio", { name: "Income" }).click();
  const incomeCats = dialog2.getByRole("group", { name: "Categories" });
  await expect(inlineChips(incomeCats)).toHaveCount(1);
  await expect(incomeCats.getByRole("button", { name: "Salary" })).toBeVisible();
  await expect(incomeCats.getByRole("button", { name: "More categories" })).toHaveCount(0);
});

test("transfer: From and To each pick from the full source list", async ({ page, api, isMobile }) => {
  await api.signup();
  for (const name of SOURCES) await api.source({ name, kind: "bank" });
  await gotoHome(page);

  const dialog = await openNewMemo(page, isMobile);
  await dialog.getByRole("radio", { name: "Transfer" }).click();
  await dialog.getByLabel("Amount").fill("25");
  const from = dialog.getByRole("group", { name: "From account" });
  const to = dialog.getByRole("group", { name: "To account" });
  await pickFromMore(page, dialog, "From account", "More sources", "revo", "Revolut");
  await pickFromMore(page, dialog, "To account", "More sources", "kredi", "Kredivo");
  await expect(from.getByRole("button", { name: "Revolut" })).toHaveAttribute("aria-pressed", "true");
  await expect(to.getByRole("button", { name: "Kredivo" })).toHaveAttribute("aria-pressed", "true");
  await editorFits(page);

  await dialog.getByPlaceholder("What was it for?").fill("Pay off");
  await dialog.getByRole("button", { name: "Save transfer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("memo-row").filter({ hasText: "Pay off" })).toContainText("Revolut → Kredivo");
});

test.describe("at 320px", () => {
  test.skip(({ isMobile }) => !isMobile, "phone-only check");
  test.use({ viewport: { width: 320, height: 640 } });

  test("the memo editor never scrolls sideways, even with long names and many choices", async ({ page, api }) => {
    await api.signup();
    const long = "Supercalifragilisticexpialidociousgroceriesandmore";
    for (const name of CATEGORIES) await api.category(name, "expense", "🍜");
    await api.category(long, "expense", "🍜");
    for (const name of SOURCES) await api.source({ name, kind: "bank" });
    await api.source({ name: "Myverylongbankaccountnamewithoutanyspaces", kind: "bank", currency: "IDR" });
    await api.source({ name: "A credit card with a rather long name", kind: "credit" });
    await gotoHome(page);

    const dialog = await openNewMemo(page, true);
    await editorFits(page);
    const categories = dialog.getByRole("group", { name: "Categories" });
    await pickFromMore(page, dialog, "Categories", "More categories", "supercali", long);
    await pickFromMore(page, dialog, "Paid with", "More sources", "myvery", "Myverylongbankaccountnamewithoutanyspaces");
    await expect(dialog.getByText(/Currency locked to IDR/)).toBeVisible();
    await editorFits(page);

    // Credit source: installments controls.
    await pickFromMore(page, dialog, "Paid with", "More sources", "credit card", "A credit card with a rather long name");
    await dialog.getByLabel("Amount").fill("1234567.89");
    await dialog.getByRole("switch", { name: "Pay in installments" }).click();
    await dialog.getByRole("button", { name: "12×" }).click();
    await editorFits(page);
    await dialog.getByRole("switch", { name: "Pay in installments" }).click();
    // Repeat and attachment controls (hidden while installments are on).
    await expect(dialog.getByRole("radiogroup", { name: "Repeat" })).toBeVisible();
    await editorFits(page);

    // New-category row.
    await categories.getByRole("button", { name: "New", exact: true }).click();
    await expect(dialog.getByLabel("New category name")).toBeVisible();
    await editorFits(page);

    await dialog.getByRole("radio", { name: "Transfer" }).click();
    await pickFromMore(page, dialog, "To account", "More sources", "myvery", "Myverylongbankaccountnamewithoutanyspaces");
    await editorFits(page);
    await expect(dialog.getByRole("button", { name: "Save transfer" })).toBeInViewport({ ratio: 1 });
  });
});
