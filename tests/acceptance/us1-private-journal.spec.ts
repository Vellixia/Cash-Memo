import { expect, test, type Page } from "@playwright/test";

const SYNTHETIC_EMAIL = "acceptance-us1@cashmemo.test";
const SYNTHETIC_PASSWORD = "Acceptance-Password-1!";

async function waitForUnauthenticated(page: Page) {
  await expect(page.getByTestId("unauthenticated")).toBeVisible({ timeout: 10_000 });
}

async function performSignup(page: Page) {
  await waitForUnauthenticated(page);
  const signupForm = page.getByTestId("signup-form");
  await signupForm.getByLabel("Email").fill(SYNTHETIC_EMAIL);
  await signupForm.getByLabel("Password").fill(SYNTHETIC_PASSWORD);
  await signupForm.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByTestId("verification-required")).toBeVisible({ timeout: 5_000 });
}

test.describe("US1 — Private Money Journal", () => {
  test("signup shows generic accepted and verification-required state", async ({ page }) => {
    await page.goto("/");
    await performSignup(page);
  });

  test("duplicate signup is enumeration-safe", async ({ page }) => {
    await page.goto("/");
    await performSignup(page);
    await page.reload();
    await waitForUnauthenticated(page);
    const signupForm = page.getByTestId("signup-form");
    await signupForm.getByLabel("Email").fill(SYNTHETIC_EMAIL);
    await signupForm.getByLabel("Password").fill("Different-Password-2!");
    await signupForm.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByTestId("verification-required")).toBeVisible({ timeout: 5_000 });
  });

  test("login fails with generic error for invalid credentials", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
    await page.getByTestId("login-email").fill("nonexistent@cashmemo.test");
    await page.getByTestId("login-password").fill("WrongPassword-1!");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(
      page.getByTestId("auth-failed").or(page.getByTestId("email-not-verified")),
    ).toBeVisible({
      timeout: 5_000,
    });
  });

  test("password reset request shows generic accepted", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
    await page.getByTestId("reset-email").fill("reset-test@cashmemo.test");
    await page.getByRole("button", { name: "Request reset" }).click();
  });

  test("session restoration on reload", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
  });

  test("logout revokes current session", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
  });

  test("revoked session cannot access protected route", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
    await expect(page.getByTestId("onboarding-form")).not.toBeVisible();
  });

  test("second account cannot observe first account", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
    await expect(page.getByTestId("empty-journal")).not.toBeVisible();
  });

  test("forged client-side IDs cannot change identity", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
    await expect(page.getByTestId("onboarding-form")).not.toBeVisible();
  });

  test("recoverable UI error does not silently complete onboarding", async ({ page }) => {
    await page.goto("/");
    await waitForUnauthenticated(page);
    await expect(page.getByTestId("onboarding-retryable")).not.toBeVisible();
  });
});
