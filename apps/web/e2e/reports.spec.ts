import { expect, noHorizontalOverflow, openNewMemo, test } from "./helpers";

test("insights: selected period, exact touch values, currency, and top spending", async ({ page, api }) => {
  await api.signup();
  const food = await api.category("Food");
  await api.memo({ direction: "income", amount_minor: 500000, note: "Salary" });
  await api.memo({ direction: "expense", amount_minor: 1250, category_id: food.id, note: "Lunch" });
  await api.memo({ direction: "expense", currency: "IDR", amount_minor: 100000, category_id: food.id, note: "Market" });

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByTestId("insight-income")).toContainText("$5,000.00");
  await expect(page.getByTestId("insight-expense")).toContainText("$12.50");
  await expect(page.getByTestId("insight-net")).toContainText("$4,987.50");
  await expect(page.getByRole("heading", { name: "Monthly trend" })).toBeVisible();
  const chart = page.getByRole("group", { name: "Monthly expense values" });
  await expect(chart.getByRole("button", { name: /expense.*\$12\.50/ })).toHaveCount(1);
  await chart.getByRole("button", { name: /expense.*\$12\.50/ }).click();
  await expect(page.getByRole("heading", { name: "Top spending" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Top spending" }).getByRole("link", { name: "View Food memos" })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Trend metric" }).getByRole("radio", { name: "Net" }).click();
  await expect(page.getByRole("group", { name: "Monthly net values" }).getByRole("button", { name: /net.*\$4,987\.50/ })).toHaveCount(1);

  await page.getByRole("radiogroup", { name: "Currency" }).getByRole("radio", { name: "IDR" }).click();
  await expect(page.getByTestId("insight-expense")).toContainText("100.000");
  await expect(page.getByTestId("insight-income")).toContainText("Rp");
  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "3M" }).click();
  await expect(page.getByText("Last 3 months · current month to date", { exact: true })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "12M" }).click();
  await expect(page.getByText("Last 12 months · current month to date", { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("insights: creating memo from global editor refreshes report without navigation", async ({ page, api, isMobile }) => {
  await api.signup();
  await api.memo({ direction: "income", amount_minor: 50000 });
  await page.goto("/reports");
  await expect(page.getByTestId("insight-income")).toContainText("$500.00");

  const editor = await openNewMemo(page, isMobile);
  await editor.getByRole("radio", { name: "Income" }).click();
  await editor.getByLabel("Amount").fill("25");
  await editor.getByRole("button", { name: "Save income" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId("insight-income")).toContainText("$525.00");
  await expect(page.getByTestId("insight-net")).toContainText("$525.00");
});

test("insights: comparison follows the selected range and drills into a filtered ledger", async ({ page, api }) => {
  await api.signup();
  const food = await api.category("Food");
  // Day 1 at 00:05 local keeps both memos inside month-to-date and its previous-month twin.
  const firsts = await page.evaluate(() => {
    const now = new Date();
    return [0, -1].map((n) => new Date(now.getFullYear(), now.getMonth() + n, 1, 0, 5).toISOString());
  });
  await api.memo({ direction: "expense", amount_minor: 3000, category_id: food.id, occurred_at: firsts[0], note: "This month food" });
  await api.memo({ direction: "expense", amount_minor: 1000, category_id: food.id, occurred_at: firsts[1], note: "Last month food" });
  await api.memo({ direction: "expense", currency: "IDR", amount_minor: 50000, category_id: food.id, occurred_at: firsts[0], note: "Rupiah food" });

  await page.goto("/reports");
  const comparison = page.getByRole("region", { name: "Compared with previous period" });
  const subtitle = comparison.locator("p").first();
  await expect(subtitle).toContainText(" vs ");
  const monthText = await subtitle.innerText();
  const row = comparison.getByRole("link", { name: /View Food memos/ });
  await expect(row).toContainText("+$20.00");
  await expect(row).toContainText("+200%");

  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "3M" }).click();
  await expect(subtitle).not.toHaveText(monthText);
  await expect(subtitle).toContainText(" vs ");
  // Multi-month windows can't open the month-scoped ledger.
  await expect(comparison.getByRole("link", { name: /View Food memos/ })).toHaveCount(0);

  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "This month" }).click();
  await comparison.getByRole("link", { name: /View Food memos/ }).click();
  await expect(page.getByTestId("memo-row").filter({ hasText: "This month food" })).toBeVisible();
  await expect(page).not.toHaveURL(/category=/);
  await expect(page).not.toHaveURL(/month=/);
  await expect(page.getByTestId("memo-row").filter({ hasText: "Rupiah food" })).toHaveCount(0);

  // Currency chip clears just the currency filter.
  await page.getByRole("button", { name: "Clear currency filter USD" }).click();
  await expect(page.getByTestId("memo-row").filter({ hasText: "Rupiah food" })).toBeVisible();

  // A cleared category filter must not come back on reload.
  await page.getByRole("combobox", { name: "Filter by category" }).click();
  await page.getByRole("option", { name: "All categories" }).click();
  await page.reload();
  await expect(page.getByTestId("memo-row").filter({ hasText: "This month food" })).toBeVisible();
  await expect(page.getByTestId("memo-row").filter({ hasText: "Rupiah food" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Clear currency filter/ })).toHaveCount(0);
});

test("insights: notes what is scheduled later this month and excluded", async ({ page, api }) => {
  await api.signup();
  const later = await page.evaluate(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() >= last ? null : new Date(now.getFullYear(), now.getMonth(), last, 12).toISOString();
  });
  test.skip(!later, "today is the last day of the month");
  await api.memo({ direction: "expense", amount_minor: 4200, occurred_at: later!, note: "Scheduled rent" });

  await page.goto("/reports");
  await expect(page.getByTestId("insight-expense")).toContainText("$0.00");
  await expect(page.getByTestId("insight-scheduled")).toContainText("Excludes $42.00 expense scheduled later this month");
});


test("insights: installments refresh trend; future installments remain excluded", async ({ page, api, isMobile }) => {
  await api.signup();
  await api.source({ name: "Credit", kind: "credit", currency: "USD" });

  await page.goto("/reports");
  await expect(page.getByTestId("insight-expense")).toContainText("$0.00");

  const editor = await openNewMemo(page, isMobile);
  await editor.getByRole("group", { name: "Paid with" }).getByRole("button", { name: "Credit" }).click();
  await editor.getByLabel("Amount").fill("90");
  await editor.getByRole("switch", { name: "Pay in installments" }).click();
  await editor.getByRole("button", { name: "3×" }).click();
  // First installment lands today at local noon; it must count even before noon. The other
  // two belong to future months.
  const firstDate = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00`;
  });
  await editor.getByLabel("Date & time").fill(firstDate);
  await editor.getByRole("button", { name: "Save expense" }).click();
  await expect(editor).toBeHidden();

  // Cache must invalidate immediately, not wait for 60s poll.
  await expect(page.getByTestId("insight-expense")).toContainText("$30.00");
  await expect(page.getByTestId("insight-net")).toContainText("30.00");
});


test("insights: editing, deleting and restoring memos updates report totals", async ({ page, api }) => {
  await api.signup();
  await api.memo({ direction: "income", amount_minor: 10000, note: "Contract work" });
  await page.goto("/reports");
  await expect(page.getByTestId("insight-income")).toContainText("$100.00");

  await page.goto("/");
  await page.getByTestId("memo-row").filter({ hasText: "Contract work" }).click();
  let editor = page.getByTestId("memo-editor");
  await editor.getByLabel("Amount").fill("150");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor).toBeHidden();

  await page.goto("/reports");
  await expect(page.getByTestId("insight-income")).toContainText("$150.00");
  await page.goto("/");
  await page.getByTestId("memo-row").filter({ hasText: "Contract work" }).click();
  editor = page.getByTestId("memo-editor");
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete memo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  // Navigating before the restore lands would abort it.
  await expect(page.getByText("Memo restored")).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByTestId("insight-income")).toContainText("$150.00");

  await page.goto("/");
  await page.getByTestId("memo-row").filter({ hasText: "Contract work" }).click();
  await page.getByTestId("memo-editor").getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete memo" }).click();
  await expect(page.getByText("Memo deleted")).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByTestId("insight-income")).toContainText("$0.00");
});
