import { PASSWORD, expect, test, uniqueEmail } from "./helpers";

test("forgot password answers the same whether or not the account exists", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot$/);
  await page.getByLabel("Email").fill(uniqueEmail("nobody"));
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
});

test("a bogus reset link says it's invalid", async ({ page, allowConsole }) => {
  allowConsole(/400/);
  await page.goto("/reset?token=not-a-real-token");
  await page.getByLabel("New password").fill("brand-new-pass-1");
  await page.getByLabel("Confirm password").fill("brand-new-pass-1");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("heading", { name: "Link expired" })).toBeVisible();
});

test("change password: the old one stops working", async ({ page, api }) => {
  const email = uniqueEmail();
  await api.signup(email);
  await page.goto("/account");
  await page.getByLabel("Current password").first().fill(PASSWORD);
  await page.getByLabel("New password").fill("another-pass-22");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();

  const login = (password: string) => page.request.post("/api/auth/login", { data: { email, password } });
  expect((await login(PASSWORD)).status()).toBe(401);
  expect((await login("another-pass-22")).status()).toBe(200);
});

test("delete account: gone after confirming with the password", async ({ page, api }) => {
  const email = uniqueEmail();
  await api.signup(email);
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(401);
});
