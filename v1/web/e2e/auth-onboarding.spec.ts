import { expect, test } from "@playwright/test";
import { completeOnboarding, isolatedUser, registerVerifyAndLogin } from "./support/auth";

test("first visit registers through delivered verification link and creates first wallet", async ({
  page,
}) => {
  const user = isolatedUser("auth-onboarding");
  await registerVerifyAndLogin(page, user);
  await completeOnboarding(page, user);

  await page.goto("/app/wallets");
  await expect(page.getByRole("heading", { name: user.walletName, level: 2 })).toBeVisible();
  await expect(page.getByText("USD · Balance 1000.00")).toBeVisible();
});
