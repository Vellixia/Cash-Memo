import { expect, gotoHome, test } from "./helpers";

// A minimal 1x1 transparent PNG, so the test doesn't depend on a fixture file.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("attach a photo to a memo, it survives reload, and can be removed", async ({ page, api }) => {
  await api.signup();
  await api.memo({ direction: "expense", amount_minor: 1250, note: "Lunch" });
  await gotoHome(page);

  await page.getByTestId("memo-row").filter({ hasText: "Lunch" }).click();
  const dialog = page.getByTestId("memo-editor");
  await expect(dialog).toBeVisible();

  // The "Choose image" input has no `capture` attribute; the camera one does.
  const chooseInput = dialog.locator('input[type="file"]:not([capture])');
  await chooseInput.setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(page.getByText("Attachment saved")).toBeVisible({ timeout: 20_000 });
  const thumbnail = dialog.getByRole("button", { name: "View attachment full size" });
  await expect(thumbnail.locator("img")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove" })).toBeVisible();

  await page.reload();
  await page.getByTestId("memo-row").filter({ hasText: "Lunch" }).click();
  const dialogAgain = page.getByTestId("memo-editor");
  await expect(dialogAgain).toBeVisible();
  await expect(dialogAgain.getByRole("button", { name: "View attachment full size" }).locator("img")).toBeVisible({ timeout: 20_000 });

  await dialogAgain.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Attachment removed")).toBeVisible({ timeout: 20_000 });
  await expect(dialogAgain.getByRole("button", { name: "Choose image" })).toBeVisible();
});
