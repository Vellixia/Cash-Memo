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
  await expect(page.getByRole("link", { name: "View Food memos" })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Trend metric" }).getByRole("radio", { name: "Net" }).click();
  await expect(page.getByRole("group", { name: "Monthly net values" }).getByRole("button", { name: /net.*\$4,987\.50/ })).toHaveCount(1);

  await page.getByRole("radiogroup", { name: "Currency" }).getByRole("radio", { name: "IDR" }).click();
  await expect(page.getByTestId("insight-expense")).toContainText("100.000");
  await expect(page.getByTestId("insight-income")).toContainText("Rp");
  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "3M" }).click();
  await expect(page.getByText("Last 3 calendar months", { exact: false })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Date range" }).getByRole("radio", { name: "12M" }).click();
  await expect(page.getByText("Last 12 calendar months", { exact: false })).toBeVisible();
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

test("insights: complete-month comparison excludes partial month and drills into filtered ledger", async ({ page, api }) => {
  await api.signup();
  const food = await api.category("Food");
  const months = await page.evaluate(() => {
    const now = new Date();
    return [-2, -1].map((n) => {
      const date = new Date(now.getFullYear(), now.getMonth() + n, 10, 12);
      return {
        month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        occurred_at: date.toISOString(),
      };
    });
  });
  await api.memo({ direction: "expense", amount_minor: 1000, category_id: food.id, occurred_at: months[0].occurred_at, note: "Older food" });
  await api.memo({ direction: "expense", amount_minor: 1500, category_id: food.id, occurred_at: months[1].occurred_at, note: "Recent food" });
  await api.memo({ direction: "expense", amount_minor: 300000, category_id: food.id, note: "Current partial food" });

  await page.goto("/reports");
  const comparison = page.getByRole("region", { name: "Compared with previous month" });
  await expect(comparison).toContainText("both complete months");
  const row = comparison.getByRole("link", { name: /View Food memos/ });
  await expect(row).toContainText("+$5.00");
  await expect(row).toContainText("+50%");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`month=${months[1].month}.*category=${food.id}`));
  await expect(page.getByTestId("memo-row").filter({ hasText: "Recent food" })).toBeVisible();
  await expect(page.getByTestId("memo-row").filter({ hasText: "Current partial food" })).toHaveCount(0);
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
  // First installment already due; following two belong to future months.
  const firstDate = await page.evaluate(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01T00:00`;
  });
  await editor.getByLabel("Date & time").fill(firstDate);
  await editor.getByRole("button", { name: "Save expense" }).click();
  await expect(editor).toBeHidden();

  // Cache must invalidate immediately, not wait for 60s poll.
  const comparison = page.getByRole("region", { name: "Compared with previous month" });
  await expect(comparison).toContainText("+$30.00");
  await expect(comparison).toContainText("New");
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
  await page.goto("/reports");
  await expect(page.getByTestId("insight-income")).toContainText("$150.00");

  await page.goto("/");
  await page.getByTestId("memo-row").filter({ hasText: "Contract work" }).click();
  await page.getByTestId("memo-editor").getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete memo" }).click();
  await page.goto("/reports");
  await expect(page.getByTestId("insight-income")).toContainText("$0.00");
});
