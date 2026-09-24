import { expect, gotoHome, openNewMemo, test } from "./helpers";

const dir = "e2e/screenshots";

/** Not an assertion suite: renders the main screens in light + dark for visual review. */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to render review screenshots");

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots (${scheme})`, async ({ page, api, isMobile }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    const shot = (name: string) => page.screenshot({ path: `${dir}/${info.project.name}-${scheme}-${name}.png`, fullPage: name !== "add" });

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await shot("login");

    await api.signup();
    const cats = {
      food: await api.category("Food", "expense", "🍜"),
      transport: await api.category("Transport", "expense", "🚌"),
      shopping: await api.category("Shopping", "expense", "🛍️"),
      bills: await api.category("Bills", "expense", "🧾"),
      fun: await api.category("Fun", "expense", "🎉"),
      salary: await api.category("Salary", "income", "💼"),
    };
    const day = (d: number, h = 12) => {
      const t = new Date();
      t.setDate(Math.max(1, t.getDate() - d));
      t.setHours(h, 15, 0, 0);
      return t.toISOString();
    };
    await api.memo({ direction: "income", amount_minor: 420000, category_id: cats.salary.id, note: "September pay", occurred_at: day(3, 9) });
    await api.memo({ direction: "expense", amount_minor: 1450, category_id: cats.food.id, note: "Ramen with Sam", occurred_at: day(0, 13) });
    await api.memo({ direction: "expense", amount_minor: 275, category_id: cats.transport.id, occurred_at: day(0, 8) });
    await api.memo({ direction: "expense", amount_minor: 8900, category_id: cats.shopping.id, note: "Running shoes", occurred_at: day(1, 18) });
    await api.memo({ direction: "expense", amount_minor: 12000, category_id: cats.bills.id, note: "Electricity", occurred_at: day(2, 10) });
    await api.memo({ direction: "expense", amount_minor: 3200, category_id: cats.fun.id, note: "Cinema", occurred_at: day(2, 20) });
    await api.memo({ direction: "expense", amount_minor: 640, note: "Parking", occurred_at: day(3, 16) });

    await gotoHome(page);
    await expect(page.getByTestId("memo-row")).toHaveCount(7);
    await shot("home");

    const dialog = await openNewMemo(page, isMobile);
    await dialog.getByLabel("Amount").fill("18.40");
    await dialog.getByRole("button", { name: /Food/ }).click();
    await page.waitForTimeout(400); // let the open animation settle
    await shot("add");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.goto("/categories");
    await expect(page.getByTestId("category-row").first()).toBeVisible();
    await shot("categories");

    await page.goto("/account");
    await expect(page.getByTestId("account-email")).toBeVisible();
    await shot("account");

    if (!isMobile) {
      await page.goto("/");
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${dir}/${info.project.name}-${scheme}-menu.png` });
    }
  });
}
