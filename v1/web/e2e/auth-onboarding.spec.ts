import { expect, test } from "@playwright/test";
import { completeOnboarding, isolatedUser, registerVerifyAndLogin } from "./support/auth";

test("first visit registers through delivered verification link and creates first wallet", async ({
  page,
}) => {
  const user = isolatedUser("auth-onboarding");
  await registerVerifyAndLogin(page, user);
  await completeOnboarding(page, user);

  await page.goto("/app");
  const brand = page.getByRole("link", { name: "Cashmemo" });
  await page.keyboard.press("Tab");
  await expect(brand).toBeFocused();
  const focusStyle = await brand.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThanOrEqual(1);

  const overview = page.getByRole("link", { name: "Overview" });
  await page.keyboard.press("Tab");
  await expect(overview).toBeFocused();
  const overviewBox = await overview.boundingBox();
  expect(overviewBox?.height).toBeGreaterThanOrEqual(44);

  const history = page.getByRole("link", { name: "History" });
  await page.keyboard.press("Tab");
  await expect(history).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/history$/);
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();

  await page.goto("/app/wallets");
  await expect(page.getByRole("heading", { name: user.walletName, level: 2 })).toBeVisible();
  await expect(page.getByText("USD · Balance 1000.00")).toBeVisible();
  const createWallet = page.getByRole("button", { name: "Create wallet" });
  expect((await createWallet.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await createWallet.click();
  expect((await page.getByLabel("Wallet name").boundingBox())?.height).toBeGreaterThanOrEqual(44);
});
