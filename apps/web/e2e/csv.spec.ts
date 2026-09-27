import { expect, gotoHome, test } from "./helpers";

test("export: the download link serves our CSV", async ({ page, api }) => {
  await api.signup();
  await api.memo({ direction: "expense", amount_minor: 1250, note: "Lunch" });
  await page.goto("/account");
  await page.getByRole("button", { name: "Export my data" }).click();
  const link = page.getByRole("link", { name: /Download \(1 rows?\)/ });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const csv = await (await page.request.get((await link.getAttribute("href"))!)).text();
  expect(csv.replace(/^﻿/, "").split("\n")[0]).toBe("date,direction,amount,currency,category,source,to_source,note");
  expect(csv).toContain("12.50,USD");
});

test("import: preview flags the bad row, then the good ones land on Home", async ({ page, api }) => {
  await api.signup();
  const month = new Date().toISOString().slice(0, 7);
  const csv = ["date,amount,note", `${month}-01,-12.50,Imported lunch`, `${month}-02,300,Imported pay`, `nope,5,Broken`].join("\n");
  await page.goto("/account/import");
  await page.locator('input[type="file"]').setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Continue" }).click();

  const importBtn = page.getByRole("button", { name: "Import 2 rows" });
  await expect(importBtn).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Line 4/i)).toBeVisible();
  await importBtn.click();
  await expect(page.getByText("Imported 2 memos")).toBeVisible({ timeout: 20_000 });

  await gotoHome(page);
  await expect(page.getByTestId("memo-row").filter({ hasText: "Imported lunch" })).toContainText("−$12.50");
  await expect(page.getByTestId("memo-row").filter({ hasText: "Imported pay" })).toContainText("+$300.00");
});
