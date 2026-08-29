import { mkdir } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./support/test";
import { completeOnboarding, isolatedUser, login, registerVerifyAndLogin } from "./support/auth";
import { connectPageToRealApi } from "./support/api";

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function viewportName(viewport: (typeof VIEWPORTS)[number]) {
  return `${String(viewport.width)}x${String(viewport.height)}`;
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  viewport: (typeof VIEWPORTS)[number],
  screen: string,
) {
  const current = new URL(page.url());
  if (!LOOPBACK_HOSTS.has(current.hostname)) {
    throw new Error("Visual review capture is allowed only on a loopback hostname.");
  }
  expect(page.viewportSize(), `${screen} viewport`).toEqual(viewport);
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth, `${screen} document width`).toBeLessThanOrEqual(metrics.clientWidth);
  const directory = testInfo.outputPath("visual-review", viewportName(viewport));
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/${screen}.png`,
    animations: "disabled",
    caret: "hide",
  });
}

async function captureEveryViewport(
  page: Page,
  testInfo: TestInfo,
  screen: string,
  prepare: (viewport: (typeof VIEWPORTS)[number]) => Promise<void>,
) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await prepare(viewport);
    await capture(page, testInfo, viewport, screen);
  }
}

async function waitForOnboardingReady(page: Page) {
  await expect(page.getByRole("heading", { name: "Confirm your timezone", level: 2 })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Loading supported currencies.");
}

async function waitForDashboardReady(page: Page) {
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading monthly summary" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading budget summary" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading recent transactions" })).toHaveCount(0);
  await expect(page.getByText("Over budget", { exact: false }).first()).toBeVisible();
}

async function waitForTransactionFormReady(page: Page) {
  await expect(page.getByRole("heading", { name: "New transaction", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Loading transaction options…");
  await expect(page.getByRole("main")).not.toContainText("Loading timezone…");
  await expect(page.getByRole("combobox", { name: "Wallet" })).not.toContainText("Choose wallet");
}

async function waitForSettingsReady(page: Page) {
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Journal preferences", level: 2 })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading preferences…" })).toHaveCount(0);
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function createTransaction(
  page: Page,
  input: {
    amount: string;
    category: string;
    direction: "expense" | "income";
    note: string;
    wallet?: string;
    occurredLocal?: string;
  },
) {
  await page.goto("/app/transactions/new");
  await page.getByLabel("Amount").fill(input.amount);
  await page
    .getByRole("radio", { name: input.direction === "income" ? "Income" : "Expense" })
    .click();
  if (input.wallet) await chooseOption(page, "Wallet", input.wallet);
  await chooseOption(page, "Category", input.category);
  if (input.occurredLocal) await page.getByLabel("Occurred at").fill(input.occurredLocal);
  await page.getByLabel("Note").fill(input.note);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/transactions",
  );
  await page.getByRole("button", { name: "Save transaction" }).click();
  expect((await created).ok()).toBe(true);
  await expect(page.getByRole("status")).toContainText("Transaction saved");
}

async function createRecurringRule(
  page: Page,
  input: { wallet: string; amount: string; note: string; startDate: string },
) {
  await page.goto("/app/recurring");
  await page.getByRole("button", { name: "New recurring rule" }).click();
  await chooseOption(page, "Wallet", input.wallet);
  await chooseOption(page, "Category", "Food & Drink");
  await page.getByLabel("Amount").fill(input.amount);
  await chooseOption(page, "Frequency", "Monthly");
  await page.getByLabel("Start date").fill(input.startDate);
  await page.getByLabel("Note").fill(input.note);
  await page.getByRole("button", { name: "Create recurring rule" }).click();
  await expect(page.getByRole("article").filter({ hasText: input.note })).toBeVisible();
}

test("captures synthetic major-screen evidence at the exact review viewports", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/login");
  await page.getByLabel("Email").fill("invalid-address");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Sign in" }).focus();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await captureEveryViewport(page, testInfo, "login-validation", () => Promise.resolve());

  const user = isolatedUser("task24-visual");
  user.walletName = "Everyday household wallet with an intentionally long synthetic name";
  expect(user.email).toMatch(/@example\.test$/);
  await registerVerifyAndLogin(page, user);
  await page.goto("/onboarding");
  await waitForOnboardingReady(page);
  await captureEveryViewport(page, testInfo, "onboarding-timezone", async () => {
    await waitForOnboardingReady(page);
  });
  await completeOnboarding(page, user, "Asia/Jakarta");

  const idrWallet = "IDR emergency reserve wallet with a deliberately long synthetic label";
  await page.goto("/app/wallets");
  await page.getByRole("button", { name: "Create wallet" }).first().click();
  const walletDialog = page.getByRole("dialog", { name: "Create wallet" });
  await walletDialog.getByLabel("Wallet name").fill(idrWallet);
  await walletDialog.getByLabel("Currency").selectOption("IDR");
  await walletDialog.getByLabel("Opening balance").fill("999999999999");
  await walletDialog.getByRole("button", { name: "Create wallet" }).click();
  await expect(page.getByRole("heading", { name: idrWallet, level: 2 })).toBeVisible();

  const idrWalletOption = `${idrWallet} — IDR`;
  const usdWalletOption = `${user.walletName} — USD`;
  const crowdedTransactions = [
    {
      amount: "9876543210",
      category: "Food & Drink",
      direction: "expense" as const,
      wallet: idrWalletOption,
      note: "Synthetic quarterly procurement memo with a very long note that must wrap without clipping across compact cards",
    },
    {
      amount: "7654321000",
      category: "Salary",
      direction: "income" as const,
      wallet: idrWalletOption,
      note: "Synthetic IDR income adjustment",
    },
    {
      amount: "123456789.01",
      category: "Food & Drink",
      direction: "expense" as const,
      wallet: usdWalletOption,
      note: "Synthetic USD expense with large exact digits",
    },
    {
      amount: "987654321.09",
      category: "Salary",
      direction: "income" as const,
      wallet: usdWalletOption,
      note: "Synthetic USD income with large exact digits",
    },
    ...Array.from({ length: 9 }, (_, index) => ({
      amount: `${String(1000 + index)}.0${String(index)}`,
      category: "Food & Drink",
      direction: "expense" as const,
      wallet: usdWalletOption,
      note: `Synthetic crowded history row ${String(index + 1)} — groceries, transit, utilities, and household notes`,
    })),
    {
      amount: "8800.00",
      category: "Food & Drink",
      direction: "expense" as const,
      wallet: usdWalletOption,
      occurredLocal: "2099-12-31T23:45",
      note: "Synthetic future-dated expense kept visibly separate from confirmed totals",
    },
  ];
  for (const transaction of crowdedTransactions) await createTransaction(page, transaction);

  await page.goto("/app/budgets");
  await chooseOption(page, "Category", "Food & Drink");
  await chooseOption(page, "Currency", "USD — US Dollar");
  await page.getByLabel("Budget amount").fill("1000000.00");
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByRole("status")).toContainText("Budget saved");
  const overBudget = page.getByRole("article").filter({ hasText: "Food & Drink" });
  await expect(overBudget).toContainText("Over budget");
  await expect(overBudget).toContainText("-");

  await createRecurringRule(page, {
    wallet: idrWalletOption,
    amount: "25000000",
    note: "Synthetic paused-on-archive monthly reserve transfer with an intentionally long memo",
    startDate: "2099-01-15",
  });
  await createRecurringRule(page, {
    wallet: usdWalletOption,
    amount: "48.75",
    note: "Synthetic active monthly household subscription",
    startDate: "2099-02-20",
  });

  await page.goto("/app/wallets");
  const idrCard = page.getByRole("article").filter({ hasText: idrWallet });
  await idrCard.getByRole("button", { name: `Actions for ${idrWallet}` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive wallet" }).click();
  await expect(idrCard).toContainText("Archived");

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);

    await page.goto("/app");
    await waitForDashboardReady(page);
    await capture(page, testInfo, viewport, "dashboard-dense-multi-currency");

    await page.goto("/app/transactions/new");
    await waitForTransactionFormReady(page);
    await page.getByLabel("Amount").fill("not-a-number");
    await page.getByLabel("Note").focus();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await capture(page, testInfo, viewport, "new-transaction-validation");

    await page.goto("/app/transactions");
    await expect(page.getByText("Synthetic crowded history row 1", { exact: false })).toBeVisible();
    const mobileFilters = page.getByRole("button", { name: "Filters" });
    if (await mobileFilters.isVisible()) await mobileFilters.click();
    await capture(page, testInfo, viewport, "history-filters-crowded");
    if (await page.getByRole("dialog", { name: "Filters" }).isVisible()) await page.keyboard.press("Escape");
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    await capture(page, testInfo, viewport, "history-long-scroll");

    await page.goto("/app/wallets");
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();
    await capture(page, testInfo, viewport, "wallets-active-archived");

    await page.goto("/app/budgets");
    await expect(page.getByRole("article").filter({ hasText: /Over budget/ }).first()).toBeVisible();
    await capture(page, testInfo, viewport, "budgets-over-100-negative");

    await page.goto("/app/recurring");
    await expect(page.getByRole("article").filter({ hasText: /Paused/ }).first()).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: /Active/ }).first()).toBeVisible();
    await capture(page, testInfo, viewport, "recurring-active-paused-future");

    await page.goto("/app/settings");
    await waitForSettingsReady(page);
    await capture(page, testInfo, viewport, "settings");

    await page.goto("/app/settings/delete-account");
    await expect(page.getByRole("button", { name: "Schedule account deletion" })).toBeVisible();
    await capture(page, testInfo, viewport, "account-deletion-destructive");
  }

  const deletionPage = await page.context().newPage();
  await connectPageToRealApi(deletionPage);
  try {
    await deletionPage.goto("/app/settings/delete-account");
    await deletionPage.getByLabel("Current password").fill(user.password);
    await deletionPage.getByRole("button", { name: "Schedule account deletion" }).click();
    await expect(deletionPage).toHaveURL(/\/login$/);
    await login(deletionPage, user, /\/deletion$/);
    await expect(deletionPage.getByRole("status")).toContainText("pending_deletion");
    await captureEveryViewport(deletionPage, testInfo, "deletion-only-grace-period", async () => {
      await expect(deletionPage.getByRole("heading", { name: "Account deletion", level: 1 })).toBeVisible();
    });
  } finally {
    await deletionPage.unrouteAll({ behavior: "ignoreErrors" });
    await deletionPage.close();
  }
});
