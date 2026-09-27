import { expect, test } from "./helpers";

const primaryVar = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());

test("Appearance: accent, font and text size persist across reload and repaint --primary", async ({ page, user }) => {
  void user;
  await page.goto("/account");

  const before = await primaryVar(page);

  await page.getByRole("radio", { name: "Ocean" }).click();
  await page.getByRole("radio", { name: "Readable" }).click();
  await page.getByRole("radiogroup", { name: "Text size" }).getByRole("radio", { name: "Large" }).click();

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-accent", "ocean");
  await expect(html).toHaveAttribute("data-font", "readable");
  await expect(html).toHaveAttribute("data-size", "large");

  const after = await primaryVar(page);
  expect(after).not.toBe(before);

  await page.reload();

  // Set before paint by the inline script — check immediately, no waiting for hydration.
  await expect(html).toHaveAttribute("data-accent", "ocean");
  await expect(html).toHaveAttribute("data-font", "readable");
  await expect(html).toHaveAttribute("data-size", "large");
  expect(await primaryVar(page)).toBe(after);

  // The settings UI itself reflects the persisted choice once mounted.
  await expect(page.getByRole("radio", { name: "Ocean" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: "Text size" }).getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "true");
});
