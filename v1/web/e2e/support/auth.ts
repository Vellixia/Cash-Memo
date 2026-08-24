import { expect, type Page } from "@playwright/test";
import { connectPageToRealApi } from "./api";
import { openDeliveredVerification } from "./mailbox";

export interface E2EUser {
  email: string;
  password: string;
  walletName: string;
}

export function isolatedUser(label: string): E2EUser {
  const suffix = `${String(Date.now())}-${crypto.randomUUID()}`;
  return {
    email: `cashmemo-e2e+${label}-${suffix}@example.test`,
    password: `Cashmemo E2E password ${suffix}`,
    walletName: `${label} wallet ${suffix}`,
  };
}

export async function registerVerifyAndLogin(page: Page, user: E2EUser): Promise<void> {
  await connectPageToRealApi(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp$/);
  await page.getByRole("link", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Verify email", level: 1 })).toBeVisible();

  await openDeliveredVerification(page, user.email);
  await expect(page.getByLabel("Verification token")).not.toHaveValue("");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("status")).toContainText("Email verified");

  await page.getByRole("link", { name: "Back to sign in" }).click();
  await login(page, user);
}

export async function login(page: Page, user: E2EUser): Promise<void> {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

export async function completeOnboarding(page: Page, user: E2EUser): Promise<void> {
  await page.goto("/onboarding");
  await expect(
    page.getByRole("heading", { name: "Confirm your timezone", level: 2 }),
  ).toBeVisible();
  await page.getByLabel("Reporting timezone").fill("UTC");
  await page.getByLabel("Default currency").selectOption("USD");
  await page.getByRole("button", { name: "Save timezone and currency" }).click();

  await expect(
    page.getByRole("heading", { name: "Start with useful categories", level: 2 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add starter categories" }).click();

  await expect(page.getByRole("heading", { name: "Create wallet", level: 2 })).toBeVisible();
  await page.getByLabel("Wallet name").fill(user.walletName);
  await expect(page.getByLabel("Currency")).toHaveValue("USD");
  await page.getByLabel("Opening balance").fill("1000.00");
  await page.getByRole("button", { name: "Create first wallet" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
}

export async function provisionUser(page: Page, label: string): Promise<E2EUser> {
  const user = isolatedUser(label);
  await registerVerifyAndLogin(page, user);
  await completeOnboarding(page, user);
  return user;
}
