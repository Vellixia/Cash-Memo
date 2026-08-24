import { expect, test } from "./support/test";
import { connectPageToRealApi } from "./support/api";
import { login, provisionUser } from "./support/auth";

test("revokes all sessions and cancels pending account deletion during grace", async ({
  browser,
  page,
}) => {
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

  await page.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(page.getByRole("status")).toContainText("Status: active");
  await expect(page.getByRole("button", { name: "Cancel deletion" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page, user);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});
