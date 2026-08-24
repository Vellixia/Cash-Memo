import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn().mockResolvedValue({ data: {} }),
  routes: [] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/transactions/new",
  useRouter: () => ({ replace: (path: string) => mocks.routes.push(path) }),
}));

vi.mock("../generated/api", () => {
  const query = (data: unknown) => ({
    data: { data },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  const mutation = () => ({ mutateAsync: mocks.mutate, isPending: false });
  return {
    getGetBudgetSummaryQueryKey: () => ["budget-summary"],
    getGetMonthlySummaryQueryKey: () => ["monthly-summary"],
    getGetWalletQueryKey: () => ["wallet"],
    getListBudgetsQueryKey: () => ["budgets"],
    getListCategoriesQueryKey: () => ["categories"],
    getListRecurringTransactionsQueryKey: () => ["recurring"],
    getListTransactionsQueryKey: () => ["transactions"],
    getListTrashedTransactionsQueryKey: () => ["trash"],
    getListWalletsQueryKey: () => ["wallets"],
    useCreateRecurringTransaction: mutation,
    useCreateTransaction: mutation,
    useGetTransactionEntryDefaults: () => query({ last_used_wallet_id: "wallet-1" }),
    useListCategories: () =>
      query([
        {
          id: "category-1",
          name: "Food & Drink",
          kind: "expense",
          archived_at: null,
        },
      ]),
    useListCurrencies: () => query([{ code: "USD", display_name: "US Dollar", exponent: 2 }]),
    useListWallets: () =>
      query([
        {
          id: "wallet-1",
          name: "Cash",
          currency: "USD",
          archived_at: null,
        },
      ]),
    useRequestAccountDeletion: mutation,
    useUpdateRecurringTransaction: mutation,
    useUpdateTransaction: mutation,
  };
});

import { AppShell } from "../components/app-shell/app-shell";
import { BudgetProgress } from "../features/budgets/budget-progress";
import { RecurringForm } from "../features/recurring/recurring-form";
import { AccountDeletion } from "../features/settings/account-deletion";
import { TransactionForm } from "../features/transactions/form";

const globalCss = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function targetPixels(value: string): number {
  const amount = Number.parseFloat(value);
  return value.endsWith("rem") ? amount * 16 : amount;
}

describe("accessibility contract", () => {
  beforeEach(() => {
    const style = document.createElement("style");
    style.dataset.cashmemoTestStyles = "true";
    style.textContent = globalCss;
    document.head.append(style);
    mocks.mutate.mockClear();
    mocks.routes.length = 0;
  });

  afterEach(() => {
    cleanup();
    document.querySelector("style[data-cashmemo-test-styles]")?.remove();
  });

  it("gives keyboard focus a visible ring and primary controls a 44px minimum target", () => {
    render(
      <aside className="sidebar">
        <nav>
          <a href="/app">Overview</a>
        </nav>
        <button className="button">Save</button>
        <input aria-label="Amount" className="input" />
      </aside>,
    );
    const link = screen.getByRole("link", { name: "Overview" });
    const button = screen.getByRole("button", { name: "Save" });
    const input = screen.getByLabelText("Amount");

    expect(targetPixels(getComputedStyle(link).minHeight)).toBeGreaterThanOrEqual(44);
    expect(targetPixels(getComputedStyle(button).minHeight)).toBeGreaterThanOrEqual(44);
    expect(targetPixels(getComputedStyle(input).minHeight)).toBeGreaterThanOrEqual(44);
    const cssRules = Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules, (rule) => rule.cssText),
    );
    expect(cssRules.join("\n")).toMatch(/button:focus-visible[^{}]*\{[^{}]*outline:/);
    expect(cssRules.join("\n")).toMatch(/\.input:focus[^{}]*\{[^{}]*outline:/);
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("keeps app landmarks and route-driven transaction form keyboard-native without modal semantics", async () => {
    renderWithQuery(
      <AppShell>
        <TransactionForm />
      </AppShell>,
    );
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
    expect(document.querySelector('nav[aria-label="Mobile navigation"]')).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New transaction", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    const amount = screen.getByLabelText("Amount");
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>("Wallet").value).toBe("wallet-1");
    });
    amount.focus();
    expect(document.activeElement).toBe(amount);
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => {
      expect(amount.getAttribute("aria-invalid")).toBe("true");
    });
    const errorId = amount.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    if (!errorId) throw new Error("amount error must be linked");
    expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
  });

  it("links recurring and account-deletion errors while preserving logical page headings", async () => {
    const recurring = renderWithQuery(
      <main>
        <h1>Recurring transactions</h1>
        <RecurringForm />
      </main>,
    );
    expect(screen.getByRole("heading", { name: "Recurring transactions", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New recurring rule", level: 2 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create recurring rule" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getByLabelText("Wallet").getAttribute("aria-describedby")).toBe(
      "recurring-wallet-error",
    );
    recurring.unmount();

    renderWithQuery(
      <main>
        <h1>Account deletion</h1>
        <AccountDeletion />
      </main>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Schedule account deletion" }));
    const password = screen.getByLabelText("Current password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe("deletion-password-error");
    expect(document.getElementById("deletion-password-error")?.getAttribute("role")).toBe("alert");
  });

  it("reduces motion and communicates budget meaning without red or green color", () => {
    render(
      <BudgetProgress
        categoryName="Food & Drink"
        budget={{
          id: "budget-1",
          category_id: "category-1",
          currency: "USD",
          budgeted: "100.00",
          spent: "120.00",
          remaining: "-20.00",
          progress: "120",
        }}
      />,
    );
    expect(screen.getByText("Over budget")).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Food & Drink budget progress" })
        .getAttribute("aria-valuetext"),
    ).toBe("120% used — over budget");
    const cssRules = Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules, (rule) => rule.cssText),
    );
    const reducedMotion = cssRules.find((rule) => rule.includes("prefers-reduced-motion: reduce"));
    expect(reducedMotion).toMatch(/animation-duration: 0?\.01ms/);
    expect(reducedMotion).toMatch(/transition-duration: 0?\.01ms/);
  });
});
