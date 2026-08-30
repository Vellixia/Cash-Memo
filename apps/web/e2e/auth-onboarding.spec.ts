import type { Locator } from "@playwright/test";
import { expect, test } from "./support/test";
import { connectPageToRealApi } from "./support/api";
import {
  completeOnboarding,
  isolatedUser,
  persistedBrowserStorage,
  registerVerifyAndLogin,
} from "./support/auth";
import { openDeliveredPasswordReset } from "./support/mailbox";

async function waitForAnimationsToFinish(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element: Element) =>
        element.getAnimations().every((animation) => animation.playState === "finished"),
      ),
    )
    .toBe(true);
}

test("first visit registers through delivered verification link and creates first wallet", async ({
  page,
}) => {
  const user = isolatedUser("auth-onboarding");
  await registerVerifyAndLogin(page, user);
  await completeOnboarding(page, user);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  const brand = page.getByRole("link", { name: "Cashmemo" });
  for (
    let tabs = 0;
    tabs < 5 && !(await brand.evaluate((node) => node === document.activeElement));
    tabs += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(brand).toBeFocused();
  const focusStyle = await brand.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(1);

  const add = page.getByRole("link", { name: "Add" });
  const overview = page.getByRole("link", { name: "Overview" });
  await page.keyboard.press("Tab");
  await expect(add).toBeFocused();
  expect((await add.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await expect(overview).toBeFocused();
  const overviewBox = await overview.boundingBox();
  expect(overviewBox?.height).toBeGreaterThanOrEqual(44);

  const transactions = page.getByRole("link", { name: "Transactions" });
  await page.keyboard.press("Tab");
  await expect(transactions).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/transactions$/);
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Search")).toBeVisible();

  await add.click();
  await expect(page).toHaveURL(/\/app\/transactions\/new$/);
  await expect(page.getByRole("heading", { name: "New transaction", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Amount")).toBeVisible();

  await page.goto("/app/wallets");
  const walletCard = page.getByRole("article").filter({ hasText: user.walletName });
  await expect(walletCard.getByRole("heading", { name: user.walletName, level: 2 })).toBeVisible();
  await expect(walletCard).toContainText("USD 1,000.00");
  await expect(walletCard).toContainText("Opening balance 1000.00");
  const createWallet = page.getByRole("button", { name: "Create wallet" });
  expect((await createWallet.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await createWallet.click();
  const walletDialog = page.getByRole("dialog");
  await expect(walletDialog).toBeVisible();
  await waitForAnimationsToFinish(walletDialog);
  const walletNameMetrics = await page.getByLabel("Wallet name").evaluate((element) => {
    const style = getComputedStyle(element as HTMLElement);
    return {
      height: element.getBoundingClientRect().height,
      minHeight: Number.parseFloat(style.minHeight || "0"),
    };
  });
  expect(walletNameMetrics.minHeight).toBeGreaterThanOrEqual(44);
  expect(walletNameMetrics.height).toBeGreaterThanOrEqual(43.5);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  const more = page.getByRole("button", { name: "More" });
  await expect(more).toBeVisible();
  await more.click();
  const moreSheet = page.getByRole("dialog");
  await expect(moreSheet).toBeVisible();
  await expect(moreSheet.getByRole("link", { name: "Wallets" })).toBeVisible();
  await expect(moreSheet.getByRole("link", { name: "Categories" })).toBeVisible();
  await expect(moreSheet.getByRole("link", { name: "Recurring" })).toBeVisible();
  await expect(moreSheet.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(moreSheet).toBeHidden();
  await expect(more).toBeFocused();
});

test("token pages send no-referrer while unrelated public pages keep normal policy", async ({
  page,
}) => {
  const tokenPage = await page.goto("/verify-email");
  expect(tokenPage?.headers()["referrer-policy"]).toBe("no-referrer");

  const resetPage = await page.goto("/reset-password");
  expect(resetPage?.headers()["referrer-policy"]).toBe("no-referrer");

  const loginPage = await page.goto("/login");
  expect(loginPage?.headers()["referrer-policy"]).toBeUndefined();

  const registerPage = await page.goto("/register");
  expect(registerPage?.headers()["referrer-policy"]).toBeUndefined();
});

test("password reset consumes a fragment token and clears it only after success", async ({
  page,
}) => {
  test.slow();
  const user = isolatedUser("reset-fragment");
  await registerVerifyAndLogin(page, user);
  await completeOnboarding(page, user);

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password", level: 1 })).toBeVisible();
  await page.getByLabel("Email").fill(user.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If we can deliver to that address");

  const deliveredUrl = await openDeliveredPasswordReset(page, user.email);
  expect(deliveredUrl).toContain("#token=");
  expect(deliveredUrl).not.toContain("?token=");

  await expect(
    page.getByRole("heading", { name: "Choose a new password", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("New password").fill("short");
  await page.getByRole("button", { name: "Change password" }).click();
  // The linked field error, not the always-visible guidance, must appear.
  await expect(page.locator("#new-password-error")).toHaveText("Use at least 12 characters");
  await expect(page.getByLabel("New password")).toHaveAttribute(
    "aria-describedby",
    /new-password-error/,
  );
  expect(new URL(page.url()).hash).toContain("#token=");

  const newPassword = `${user.password} rotated`;
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(new URL(page.url()).hash).toBe("");
  expect(await persistedBrowserStorage(page)).toEqual({ local: [], session: [] });

  await connectPageToRealApi(page);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});
