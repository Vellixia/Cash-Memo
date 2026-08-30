import { expect, test } from "./support/test";
import { provisionUser } from "./support/auth";
import { apiUrl } from "./support/api";
import { createTransaction } from "./support/transactions";

test("filters, edits, trashes, and restores one memo", async ({ page }) => {
  const user = await provisionUser(page, "history-trash");
  const originalNote = `Original ${user.email}`;
  const editedNote = `Edited ${user.email}`;
  await createTransaction(page, {
    amount: "21.00",
    category: "Food & Drink",
    direction: "expense",
    note: originalNote,
  });
  await createTransaction(page, {
    amount: "22.00",
    category: "Transport",
    direction: "expense",
    note: `Other ${user.email}`,
  });

  const historyRequests: string[] = [];
  let firstPage: { items?: unknown[]; next_cursor?: string | null } | undefined;
  let cursorAttempts = 0;
  const loadedPageMemo = `Loaded ${user.email}`;
  let walletId: string | undefined;
  let categoryId: string | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/transactions") historyRequests.push(request.url());
  });
  await page.route("**/api/v1/transactions**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/transactions" || route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const response = await route.fetch({ url: apiUrl(`${url.pathname}${url.search}`) });
    if (url.searchParams.get("cursor") === "synthetic-next" && firstPage) {
      cursorAttempts += 1;
      if (cursorAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "cursor unavailable" }),
        });
        return;
      }
      const firstItem = firstPage.items?.[0];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...firstPage,
          items: firstItem && typeof firstItem === "object"
            ? [{ ...firstItem, id: `loaded-${user.email}`, note: loadedPageMemo }]
            : [],
          next_cursor: null,
        }),
      });
      return;
    }
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      await route.fulfill({ response });
      return;
    }
    const payload = await response.json() as { items?: unknown[]; next_cursor?: string | null };
    if (!url.searchParams.has("cursor")) {
      firstPage = payload;
      const firstItem = payload.items?.[0];
      if (firstItem && typeof firstItem === "object") {
        walletId = "wallet_id" in firstItem && typeof firstItem.wallet_id === "string" ? firstItem.wallet_id : undefined;
        categoryId = "category_id" in firstItem && typeof firstItem.category_id === "string" ? firstItem.category_id : undefined;
      }
      payload.next_cursor = "synthetic-next";
    }
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/app/transactions?from=2020-01-01&to=2099-12-31&type=expense");
  await expect.poll(() => historyRequests.some((value) => {
    const url = new URL(value);
    return url.searchParams.get("from") === "2020-01-01" && url.searchParams.get("to") === "2099-12-31";
  })).toBe(true);
  await expect(page.getByRole("button", { name: "Load more" })).toBeVisible();
  const firstPageMemo = page.getByText(originalNote, { exact: true });
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(firstPageMemo).toBeVisible();
  await expect(page.locator("div.field-error[role='alert']")).toContainText("Could not load more transactions");
  await expect.poll(() => historyRequests.filter((value) => new URL(value).searchParams.get("cursor") === "synthetic-next")).toHaveLength(1);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(loadedPageMemo, { exact: true })).toBeVisible();
  await expect.poll(() => historyRequests.filter((value) => new URL(value).searchParams.get("cursor") === "synthetic-next")).toHaveLength(2);
  if (!walletId || !categoryId) throw new Error("synthetic transaction filter IDs missing");
  await page.getByRole("textbox", { name: "Wallet" }).fill(walletId);
  await expect(page).toHaveURL(new RegExp(`[?&]wallet=${walletId}(?:&|$)`));
  await expect.poll(() => historyRequests.some((value) => new URL(value).searchParams.get("wallet_id") === walletId)).toBe(true);
  await page.getByRole("textbox", { name: "Category" }).fill(categoryId);
  await expect(page).toHaveURL(new RegExp(`[?&]category=${categoryId}(?:&|$)`));
  await expect.poll(() => historyRequests.some((value) => new URL(value).searchParams.get("category_id") === categoryId)).toBe(true);
  await page.getByRole("textbox", { name: "Wallet" }).fill("");
  await page.getByRole("textbox", { name: "Category" }).fill("");
  await expect(page).toHaveURL(/type=expense(?:$|&)/);
  await page.getByRole("textbox", { name: "Search" }).fill(originalNote);
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByText(originalNote, { exact: true })).toBeVisible();
  await expect(page.getByText(`Other ${user.email}`, { exact: true })).toHaveCount(0);

  const originalCard = page.getByRole("article").filter({ hasText: originalNote });
  await originalCard.getByRole("link", { name: /Expense/ }).click();
  await page.getByLabel("Amount").fill("23.50");
  await page.getByLabel("Note").fill(editedNote);
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction saved");

  await page.goto("/app/transactions");
  await page.getByLabel("Search").fill(editedNote);
  await expect(page).not.toHaveURL(/q=/);
  const editedCard = page.getByRole("article").filter({ hasText: editedNote });
  await expect(editedCard).toBeVisible();
  await editedCard.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.getByRole("status")).toContainText("moved to Trash");
  await expect(editedCard).toHaveCount(0);

  const sonnerUndo = page.locator("[data-sonner-toast]").getByRole("button", { name: "Undo" });
  await expect(sonnerUndo).toBeVisible();
  await sonnerUndo.click();
  await expect(page.getByRole("status")).toContainText("Transaction restored");
  const restoredCard = page.getByRole("article").filter({ hasText: editedNote });
  await expect(restoredCard).toBeVisible();

  await restoredCard.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.getByRole("status")).toContainText("moved to Trash");

  await page.goto("/app/transactions/trash");
  const trashedCard = page.getByRole("article").filter({ hasText: "USD 23.50" });
  await expect(trashedCard).toBeVisible();
  await page.route("**/api/v1/transactions/*/restore", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "restore unavailable" }) });
  });
  await trashedCard.getByRole("button", { name: "Restore" }).click();
  await expect(page.locator("p[role='alert']")).toContainText("503");
  await page.unroute("**/api/v1/transactions/*/restore");
  await trashedCard.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status")).toContainText("Transaction restored");
  await expect(trashedCard).toHaveCount(0);

  await page.goto("/app/transactions");
  await page.getByLabel("Search").fill(editedNote);
  await expect(page.getByText(editedNote, { exact: true })).toBeVisible();
  const finalCard = page.getByRole("article").filter({ hasText: editedNote });
  await finalCard.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await page.goto("/app/transactions/trash");
  const foreverCard = page.getByRole("article").filter({ hasText: "USD 23.50" });
  await foreverCard.getByRole("button", { name: "Delete forever" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("cannot be undone");
  await dialog.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByRole("status")).toContainText("permanently deleted");
  await expect(foreverCard).toHaveCount(0);
});
