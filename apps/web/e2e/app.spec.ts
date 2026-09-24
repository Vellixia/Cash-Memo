import { apiFor, expect, gotoHome, noHorizontalOverflow, openNewMemo, PASSWORD, test, uniqueEmail } from "./helpers";

const monthName = (offset = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

test.describe("auth", () => {
  test("visiting / without a session redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("signup via the form lands on a first-run home, starter set adds categories", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup$/);

    // Client-side validation first.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    await page.getByLabel("Email").fill(uniqueEmail("signup"));
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 8 characters")).toBeVisible();

    // Show/hide password toggle.
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/$/);
    const starter = page.getByRole("region", { name: "Start with a few categories" });
    await expect(starter).toBeVisible();
    await expect(page.getByText("A blank page")).toBeVisible();

    await starter.getByRole("button", { name: "Add starter set" }).click();
    await expect(page.getByText("Starter categories added")).toBeVisible();
    await expect(starter).toBeHidden();

    await page.goto("/categories");
    for (const name of ["Food", "Transport", "Shopping", "Bills", "Fun"]) await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Income" }).click();
    for (const name of ["Salary", "Other income"]) await expect(page.getByText(name, { exact: true })).toBeVisible();
  });

  test("login with a wrong password shows an error and stays on /login", async ({ page, playwright, allowConsole }) => {
    allowConsole(/status of 401/);
    const anon = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    const { email } = await apiFor(anon).signup();
    await anon.dispose();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Wrong email or password" })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("login with the right password opens home", async ({ page, playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    const { email } = await apiFor(anon).signup();
    await anon.dispose();

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("hero-net")).toBeVisible();
  });

  test("logout from the account page", async ({ page, user }) => {
    await page.goto("/account");
    await expect(page.getByTestId("account-email")).toHaveText(user.email);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("account menu (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "the account menu lives in the desktop top bar");

  test("opens and every item works", async ({ page, user }) => {
    await gotoHome(page);
    const menuButton = page.getByRole("button", { name: "Account menu" });

    await menuButton.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText(user.email)).toBeVisible();
    await menu.getByRole("menuitem", { name: "Categories" }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(page.getByRole("heading", { name: "Categories", exact: true })).toBeVisible();
    await expect(menu).toBeHidden();

    await menuButton.click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();

    await menuButton.click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.getByRole("menuitemradio", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    await expect(page.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("logout from the account menu", async ({ page, user }) => {
    void user;
    await gotoHome(page);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test("theme choice persists across reloads", async ({ page, user }) => {
  void user;
  await page.goto("/account");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Light" }).click();
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});

test("month switcher: prev / next / picker change the label and the data", async ({ page, api }) => {
  await api.signup();
  await api.memo({ direction: "expense", amount_minor: 4200, note: "This month coffee" });
  await gotoHome(page);
  const label = page.getByTestId("month-label");
  await expect(label).toHaveText(monthName());
  await expect(page.getByText("This month coffee")).toBeVisible();

  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(label).toHaveText(monthName(-1));
  await expect(page.getByText("A blank page")).toBeVisible();
  await expect(page.getByTestId("hero-expense")).toHaveText("$0.00");

  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(label).toHaveText(monthName(1));
  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page.getByTestId("hero-expense")).toHaveText("$42.00");

  await label.click();
  const year = new Date().getFullYear();
  await page.getByRole("button", { name: "Previous year" }).click();
  await page.getByRole("button", { name: `March ${year - 1}` }).click();
  await expect(label).toHaveText(`March ${year - 1}`);
  await expect(page.getByText("A blank page")).toBeVisible();

  await label.click();
  await page.getByRole("button", { name: "Jump to this month" }).click();
  await expect(label).toHaveText(monthName());
  await expect(page.getByText("This month coffee")).toBeVisible();
});

test.describe("memos", () => {
  test("add an expense with a category chip: ledger, hero and donut update", async ({ page, api, isMobile }) => {
    await api.signup();
    await api.category("Food", "expense", "🍜");
    await api.category("Salary", "income", "💼");
    await gotoHome(page);
    await expect(page.getByTestId("hero-expense")).toHaveText("$0.00");

    const dialog = await openNewMemo(page, isMobile);
    await expect(dialog.getByRole("radio", { name: "Expense" })).toHaveAttribute("aria-checked", "true");
    // Only expense categories are offered.
    await expect(dialog.getByRole("button", { name: /Salary/ })).toHaveCount(0);
    await dialog.getByLabel("Amount").fill("12.50");
    await dialog.getByRole("button", { name: /Food/ }).click();
    await expect(dialog.getByRole("button", { name: /Food/ })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByPlaceholder("What was it for?").fill("Ramen lunch");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Expense added")).toBeVisible();

    const row = page.getByTestId("memo-row").filter({ hasText: "Ramen lunch" });
    await expect(row).toContainText("Food");
    await expect(row).toContainText("−$12.50");
    await expect(page.getByTestId("hero-expense")).toHaveText("$12.50");
    await expect(page.getByTestId("hero-net")).toHaveText("−$12.50");
    const legend = page.getByTestId("donut-legend");
    await expect(legend).toContainText("Food");
    await expect(legend).toContainText("$12.50");
    await expect(legend).toContainText("100%");
    await expect(page.getByText("Today", { exact: true })).toBeVisible();
  });

  test("add an income memo", async ({ page, api, isMobile }) => {
    await api.signup();
    await api.category("Salary", "income", "💼");
    await gotoHome(page);
    const dialog = await openNewMemo(page, isMobile);
    await dialog.getByRole("radio", { name: "Income" }).click();
    await dialog.getByLabel("Amount").fill("2500");
    await dialog.getByRole("button", { name: /Salary/ }).click();
    await dialog.getByLabel("Amount").press("Enter"); // Enter in a field submits
    await expect(dialog).toBeHidden();

    const row = page.getByTestId("memo-row").filter({ hasText: "Salary" });
    await expect(row).toContainText("+$2,500.00");
    await expect(page.getByTestId("hero-income")).toHaveText("$2,500.00");
    await expect(page.getByTestId("hero-net")).toHaveText("+$2,500.00");
  });

  test("validation: empty and zero amounts are rejected inline", async ({ page, user, isMobile }) => {
    void user;
    await gotoHome(page);
    const dialog = await openNewMemo(page, isMobile);
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog.getByText("Enter an amount")).toBeVisible();
    await dialog.getByLabel("Amount").fill("0");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog.getByText("Amount must be greater than zero")).toBeVisible();
    await dialog.getByLabel("Amount").fill("abc");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog.getByText("Enter a number like 12.50")).toBeVisible();
    // Bad currency code.
    await dialog.getByLabel("Amount").fill("5");
    await dialog.getByRole("button", { name: /Currency USD/ }).click();
    await dialog.getByLabel("Currency code").fill("US");
    await dialog.getByLabel("Currency code").press("Enter");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog.getByText("Use a 3-letter code like USD")).toBeVisible();
    // Esc closes without saving.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("A blank page")).toBeVisible();
  });

  test("edit a memo: amount, note and category", async ({ page, api }) => {
    await api.signup();
    const food = await api.category("Food", "expense", "🍜");
    await api.category("Fun", "expense", "🎉");
    await api.memo({ direction: "expense", amount_minor: 1000, note: "Snacks", category_id: food.id });
    await gotoHome(page);

    await page.getByTestId("memo-row").filter({ hasText: "Snacks" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Edit memo" })).toBeVisible();
    await expect(dialog.getByLabel("Amount")).toHaveValue("10.00");
    await expect(dialog.getByRole("button", { name: /Food/ })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByLabel("Amount").fill("33.30");
    await dialog.getByPlaceholder("What was it for?").fill("Movie night");
    await dialog.getByRole("button", { name: /Fun/ }).click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Memo updated")).toBeVisible();

    const row = page.getByTestId("memo-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Movie night");
    await expect(row).toContainText("Fun");
    await expect(row).toContainText("−$33.30");
    await expect(page.getByTestId("hero-expense")).toHaveText("$33.30");
    await expect(page.getByTestId("donut-legend")).toContainText("Fun");
    await expect(page.getByTestId("donut-legend")).not.toContainText("Food");
  });

  test("delete a memo after confirming", async ({ page, api }) => {
    await api.signup();
    await api.memo({ direction: "expense", amount_minor: 999, note: "Delete me" });
    await gotoHome(page);
    await page.getByTestId("memo-row").filter({ hasText: "Delete me" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Delete" }).click();

    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Delete this memo?");
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete memo" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Memo deleted")).toBeVisible();
    await expect(page.getByTestId("memo-row")).toHaveCount(0);
    await expect(page.getByText("A blank page")).toBeVisible();
    await expect(page.getByTestId("hero-expense")).toHaveText("$0.00");
  });

  test("filter the ledger by direction and by category", async ({ page, api }) => {
    await api.signup();
    const food = await api.category("Food", "expense", "🍜");
    const bills = await api.category("Bills", "expense", "🧾");
    const salary = await api.category("Salary", "income", "💼");
    await api.memo({ direction: "expense", amount_minor: 500, note: "Tacos", category_id: food.id });
    await api.memo({ direction: "expense", amount_minor: 8000, note: "Power bill", category_id: bills.id });
    await api.memo({ direction: "income", amount_minor: 300000, note: "Paycheck", category_id: salary.id });
    await gotoHome(page);
    const rows = page.getByTestId("memo-row");
    await expect(rows).toHaveCount(3);

    const directions = page.getByRole("radiogroup", { name: "Filter by direction" });
    await directions.getByRole("radio", { name: "Income" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Paycheck");
    await directions.getByRole("radio", { name: "Expense" }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Paycheck" })).toHaveCount(0);

    await page.getByRole("combobox", { name: "Filter by category" }).click();
    // Only expense categories are offered while "Expense" is selected.
    await expect(page.getByRole("option", { name: /Salary/ })).toHaveCount(0);
    await page.getByRole("option", { name: /Bills/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Power bill");
    await expect(page.getByRole("combobox", { name: "Filter by category" })).toContainText("Bills");

    await directions.getByRole("radio", { name: "Income" }).click();
    // The expense category no longer applies, so it resets to all categories.
    await expect(page.getByRole("combobox", { name: "Filter by category" })).toContainText("All categories");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Paycheck");

    await directions.getByRole("radio", { name: "All" }).click();
    await expect(rows).toHaveCount(3);
  });

  test("multi-currency: switcher appears and switches hero totals", async ({ page, api }) => {
    await api.signup();
    await api.memo({ direction: "expense", amount_minor: 1500, currency: "USD", note: "Dollar lunch" });
    await gotoHome(page);
    await expect(page.getByRole("radiogroup", { name: "Currency" })).toHaveCount(0);

    await api.memo({ direction: "expense", amount_minor: 4000, currency: "EUR", note: "Euro dinner" });
    await api.memo({ direction: "income", amount_minor: 10000, currency: "EUR", note: "Euro refund" });
    await page.reload();
    const switcher = page.getByRole("radiogroup", { name: "Currency" });
    await expect(switcher).toBeVisible();
    await expect(page.getByTestId("hero-expense")).toHaveText("$15.00");

    await switcher.getByRole("radio", { name: "EUR" }).click();
    await expect(page.getByTestId("hero-expense")).toHaveText("€40.00");
    await expect(page.getByTestId("hero-income")).toHaveText("€100.00");
    await expect(page.getByTestId("hero-net")).toHaveText("+€60.00");
    await expect(page.getByTestId("donut-legend")).toContainText("Uncategorized");
    await expect(page.getByTestId("donut-legend")).toContainText("€40.00");

    await switcher.getByRole("radio", { name: "USD" }).click();
    await expect(page.getByTestId("hero-net")).toHaveText("−$15.00");
  });

  test("new category from inside the memo form is created and selected", async ({ page, user, isMobile }) => {
    void user;
    await gotoHome(page);
    const dialog = await openNewMemo(page, isMobile);
    await dialog.getByRole("button", { name: "New", exact: true }).click();
    await dialog.getByRole("button", { name: "Choose emoji" }).click();
    await page.getByRole("button", { name: "☕" }).click();
    await dialog.getByLabel("New category name").fill("Coffee");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByRole("button", { name: /Coffee/ })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByLabel("Amount").fill("4.20");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByTestId("memo-row");
    await expect(row).toContainText("Coffee");
    await expect(row).toContainText("☕");
  });
});

test("categories page: add, rename, change emoji, delete", async ({ page, user }) => {
  void user;
  await page.goto("/categories");
  await expect(page.getByRole("heading", { name: "Categories", exact: true })).toBeVisible();

  // Add (expense tab), with an emoji.
  await page.getByRole("button", { name: "Choose emoji" }).click();
  await page.getByRole("button", { name: "🛒" }).click();
  await page.getByLabel("Category name").fill("Groceries");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added “Groceries”")).toBeVisible();
  const row = page.getByTestId("category-row").filter({ hasText: "Groceries" });
  await expect(row).toContainText("🛒");
  await expect(page.getByLabel("Category name")).toHaveValue("");

  // Empty name is rejected inline.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Give it a name" })).toBeVisible();

  // Rename.
  await row.getByRole("button", { name: "Rename Groceries" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Supermarket");
  await page.getByRole("button", { name: "Save category" }).click();
  const renamed = page.getByTestId("category-row").filter({ hasText: "Supermarket" });
  await expect(renamed).toBeVisible();
  await expect(page.getByTestId("category-row").filter({ hasText: "Groceries" })).toHaveCount(0);

  // Change emoji directly from the row (typed emoji).
  await renamed.getByRole("button", { name: "Change emoji for Supermarket" }).click();
  await page.getByLabel("Type any emoji").fill("🥦");
  await page.getByLabel("Type any emoji").press("Enter");
  await expect(renamed).toContainText("🥦");
  // ...and remove it.
  await renamed.getByRole("button", { name: "Change emoji for Supermarket" }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(renamed).not.toContainText("🥦");

  // Survives a reload (server state, not local).
  await page.reload();
  await expect(page.getByTestId("category-row").filter({ hasText: "Supermarket" })).toBeVisible();

  // Income tab is separate.
  await page.getByRole("radio", { name: "Income" }).click();
  await expect(page.getByText("No income categories yet. Add one above.")).toBeVisible();
  await page.getByRole("radio", { name: "Expense" }).click();

  // Delete with confirm.
  await page.getByRole("button", { name: "Delete Supermarket" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete “Supermarket”?");
  await confirm.getByRole("button", { name: "Delete category" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId("category-row")).toHaveCount(0);
});

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "bottom navigation is mobile-only");

  test("bottom nav moves between tabs and the add sheet saves", async ({ page, user }) => {
    void user;
    await gotoHome(page);
    const tabs = page.getByRole("navigation", { name: "Tabs" });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole("button", { name: "New memo" })).toBeHidden();

    await tabs.getByRole("link", { name: "Categories" }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(tabs.getByRole("link", { name: "Categories" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Account" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await tabs.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL(/\/$/);

    await tabs.getByRole("button", { name: "Add memo" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    // It is a bottom sheet: anchored to the bottom edge of the viewport.
    const box = await sheet.boundingBox();
    const viewport = page.viewportSize()!;
    expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(viewport.height - 1);
    expect(Math.round(box!.width)).toBe(viewport.width);

    await sheet.getByLabel("Amount").fill("7.25");
    await sheet.getByPlaceholder("What was it for?").fill("Bus pass");
    await sheet.getByRole("button", { name: "Save expense" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("memo-row").filter({ hasText: "Bus pass" })).toContainText("−$7.25");
  });
});

test("no horizontal overflow on home, categories, account, login", async ({ page, api }) => {
  await api.signup();
  const food = await api.category("A very long category name that keeps going", "expense", "🍜");
  await api.memo({
    direction: "expense",
    amount_minor: 123456789,
    note: "An extremely long note that should truncate instead of pushing the layout sideways",
    category_id: food.id,
  });
  await api.memo({ direction: "income", amount_minor: 5000, currency: "EUR" });
  for (const path of ["/", "/categories", "/account"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await noHorizontalOverflow(page);
  }
  await page.context().clearCookies();
  await page.goto("/login");
  await noHorizontalOverflow(page);
});
