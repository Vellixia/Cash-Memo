import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/test";
import { login, provisionUser } from "./support/auth";
import { createTransaction } from "./support/transactions";

const HIGH_IMPACT = new Set(["critical", "serious"]);

function cssTimeMilliseconds(value: string) {
  const amount = Number.parseFloat(value);
  return value.trim().endsWith("ms") ? amount : amount * 1000;
}

async function expectNoHighImpactViolations(page: Page, screen: string) {
  // No exclusions: every rendered node on these stable application states is in scope.
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter((violation) => HIGH_IMPACT.has(violation.impact ?? ""));
  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
    `${screen} must have zero serious or critical axe violations`,
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, screen: string) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth, `${screen} document width`).toBeLessThanOrEqual(metrics.clientWidth);
}

async function expectOnePageHeading(page: Page, name: string | RegExp) {
  await expect(page.getByRole("heading", { name, level: 1 })).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
}

async function expectFocusedAboveBottomNav(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect(control).toBeFocused();
  const [controlBox, navBox] = await Promise.all([
    control.boundingBox(),
    page.locator(".bottom-nav").boundingBox(),
  ]);
  expect(controlBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  if (!controlBox || !navBox) throw new Error("focused control and mobile navigation need layout boxes");
  expect(controlBox.y + controlBox.height, "focused control must remain above fixed navigation").toBeLessThanOrEqual(
    navBox.y,
  );
}

test("public login has a working skip link and no high-impact axe violations", async ({ page }) => {
  await page.goto("/login");
  await expectOnePageHeading(page, "Sign in");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  const main = page.getByRole("main");
  await expect(main).toBeFocused();
  await expect(main).toHaveAttribute("id", "main-content");
  await expect(main).toHaveAttribute("tabindex", "-1");

  await expectNoHighImpactViolations(page, "login");
});

test("authenticated flows preserve reflow, focus, semantics, and non-color meaning", async ({
  page,
}) => {
  test.setTimeout(360_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = await provisionUser(page, "task24-accessibility", "Asia/Jakarta");
  await createTransaction(page, {
    amount: "24.00",
    category: "Food & Drink",
    direction: "expense",
    note: "Synthetic accessibility expense",
  });
  await createTransaction(page, {
    amount: "125.00",
    category: "Salary",
    direction: "income",
    note: "Synthetic accessibility income",
  });

  await page.goto("/app");
  await expectOnePageHeading(page, "Overview");
  await expect(page.getByText("Income", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Expense", { exact: true }).first()).toBeVisible();
  await expectNoHighImpactViolations(page, "dashboard");

  await page.goto("/app/transactions/new");
  await expectOnePageHeading(page, "New transaction");
  await expect(page.getByRole("radio", { name: "Expense" })).toBeChecked();
  await expectNoHighImpactViolations(page, "new transaction");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/transactions");
  await expectNoHorizontalOverflow(page, "history at 375px");
  const filters = page.getByRole("button", { name: "Filters" });
  await filters.focus();
  await filters.click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(":focus")).toHaveCount(1);
  await expectNoHighImpactViolations(page, "history filter Sheet");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(filters).toBeFocused();

  await page.goto("/app/wallets");
  const createWallet = page.getByRole("button", { name: "Create wallet" }).first();
  await createWallet.click();
  const walletDialog = page.getByRole("dialog", { name: "Create wallet" });
  await expect(walletDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(walletDialog).toBeHidden();
  await expect(createWallet).toBeFocused();

  const motion = await createWallet.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(cssTimeMilliseconds(motion.animationDuration)).toBeCloseTo(0.01, 5);
  expect(cssTimeMilliseconds(motion.transitionDuration)).toBeCloseTo(0.01, 5);

  // 1280px at 200% browser zoom has a 640 CSS-pixel effective viewport.
  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto("/app");
  await expectNoHorizontalOverflow(page, "dashboard at 200% effective zoom");
  await expectOnePageHeading(page, "Overview");

  await page.setViewportSize({ width: 375, height: 500 });
  await page.goto("/app/transactions/new");
  await page.getByLabel("Amount").fill("24.00");
  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Food & Drink", exact: true }).click();
  const save = page.getByRole("button", { name: "Save transaction" });
  await expect(save).toBeEnabled();
  await expectFocusedAboveBottomNav(page, save);
  const inset = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".app-main");
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    if (!main || !nav) throw new Error("app shell layout missing");
    return {
      mainPaddingBottom: Number.parseFloat(getComputedStyle(main).paddingBottom),
      navHeight: nav.getBoundingClientRect().height,
      safeArea: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-bottom"),
    };
  });
  expect(inset.safeArea.trim()).not.toBe("");
  expect(inset.mainPaddingBottom).toBeGreaterThanOrEqual(inset.navHeight);
  await expectNoHorizontalOverflow(page, "small-height transaction form");

  // Representative long management forms must remain keyboard-reachable above fixed mobile nav.
  await page.goto("/app/budgets");
  await expectOnePageHeading(page, "Budgets");
  const createBudget = page.getByRole("button", { name: "Create budget" });
  await expectFocusedAboveBottomNav(page, createBudget);
  await expectNoHorizontalOverflow(page, "small-height budget form");

  await page.goto("/app/recurring");
  await expectOnePageHeading(page, "Recurring transactions");
  const newRecurring = page.getByRole("button", { name: "New recurring rule" });
  await expectFocusedAboveBottomNav(page, newRecurring);
  await newRecurring.click();
  const recurringDialog = page.getByRole("dialog", { name: "New recurring rule" });
  await expect(recurringDialog).toBeVisible();
  await expectFocusedAboveBottomNav(page, recurringDialog.getByRole("button", { name: "Create recurring rule" }));
  await expectNoHorizontalOverflow(page, "small-height recurring form");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/settings");
  await expectOnePageHeading(page, "Settings");
  await expectNoHighImpactViolations(page, "settings");

  await page.goto("/app/settings/delete-account");
  await expectOnePageHeading(page, "Account deletion");
  await expect(page.getByRole("heading", { name: "Delete account", level: 2 })).toBeVisible();
  await expect(page.getByText(/7-day grace period/)).toBeVisible();
  await expectNoHighImpactViolations(page, "account deletion settings");
  await page.getByLabel("Current password").fill(user.password);
  await page.getByRole("button", { name: "Schedule account deletion" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expectOnePageHeading(page, "Sign in");
  await login(page, user, /\/deletion$/);
  await expectOnePageHeading(page, "Account deletion");
  await expect(page.getByRole("status")).toContainText("pending_deletion");
  await expectNoHighImpactViolations(page, "deletion-only page");
});
