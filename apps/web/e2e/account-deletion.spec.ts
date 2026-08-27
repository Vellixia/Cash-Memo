import { expect, test } from "./support/test";
import { connectPageToRealApi } from "./support/api";
import { login, persistedBrowserStorage, provisionUser } from "./support/auth";

const FINANCIAL_API_PATH =
  /^\/api\/v1\/(transactions|wallets|categories|budgets|recurring|reports|dashboard|onboarding)/;

test("revokes all sessions and cancels pending account deletion during grace", async ({
  browser,
  page,
}) => {
  test.slow();
  const user = await provisionUser(page, "account-deletion");
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await connectPageToRealApi(secondPage);
  await login(secondPage, user);

  await page.goto("/app/settings/sessions");
  await page.getByRole("button", { name: "Sign out all sessions" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await secondPage.goto("/app");
  await expect(secondPage).toHaveURL(/\/login\?returnTo=%2Fapp$/);
  await secondPage.unrouteAll({ behavior: "wait" });
  await secondContext.close();

  await login(page, user);
  await page.goto("/app/settings/delete-account");
  await expect(page.getByText(/7-day grace period/)).toBeVisible();
  await expect(page.getByText(/encrypted backups may retain deleted data/)).toBeVisible();
  await page.getByLabel("Current password").fill(user.password);
  await page.getByRole("button", { name: "Schedule account deletion" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, user, /\/deletion$/);
  await expect(page.getByRole("status")).toContainText("pending_deletion");

  const financialRequests: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (FINANCIAL_API_PATH.test(pathname)) financialRequests.push(pathname);
  });

  // Restricted mode never mounts the financial shell or starts financial queries.
  await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "History" })).toHaveCount(0);
  await page.goto("/app/transactions");
  await expect(page).toHaveURL(/\/deletion$/);
  await expect(page.getByRole("heading", { name: "Account deletion", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
  expect(financialRequests).toEqual([]);
  expect(await persistedBrowserStorage(page)).toEqual({ local: [], session: [] });

  await page.getByLabel("Confirm password").fill("wrong password entirely");
  await page.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(page.getByText(/Deletion is still scheduled/)).toBeVisible();
  await expect(page).toHaveURL(/\/deletion$/);
  await expect(page.getByRole("status")).toContainText("pending_deletion");

  await page.getByLabel("Confirm password").fill(user.password);
  await page.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(financialRequests).toEqual([]);
  await login(page, user);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});
