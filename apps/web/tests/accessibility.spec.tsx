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

function renderWithQuery(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("accessibility contract", () => {
  beforeEach(() => {
    mocks.mutate.mockClear();
    mocks.routes.length = 0;
  });

  afterEach(cleanup);

  it("keeps real app landmarks and route-driven transaction form semantics", async () => {
    renderWithQuery(
      <AppShell>
        <TransactionForm />
      </AppShell>,
    );
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
    expect(document.querySelector('nav[aria-label="Mobile navigation"]')).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "History" })
        .every((link) => link.getAttribute("href") === "/app/transactions"),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: "Add" })
        .every((link) => link.getAttribute("href") === "/app/transactions/new"),
    ).toBe(true);
    expect(screen.queryByRole("link", { name: "Capture" })).toBeNull();
    expect(screen.getByRole("heading", { name: "New transaction", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    const amount = screen.getByLabelText("Amount");
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>("Wallet").value).toBe("wallet-1");
    });
    const transactionForm = amount.closest("form");
    expect(transactionForm).toBeTruthy();
    if (!transactionForm) throw new Error("transaction amount must belong to its form");
    fireEvent.submit(transactionForm);
    await waitFor(() => {
      expect(amount.getAttribute("aria-invalid")).toBe("true");
    });
    const errorId = amount.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    if (!errorId) throw new Error("amount error must be linked");
    expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
  });

  it("links recurring and account-deletion errors from real component forms", async () => {
    const recurring = renderWithQuery(<RecurringForm />);
    expect(screen.getByRole("heading", { name: "New recurring rule", level: 2 })).toBeTruthy();
    const recurringForm = screen
      .getByRole("button", { name: "Create recurring rule" })
      .closest("form");
    expect(recurringForm).toBeTruthy();
    if (!recurringForm) throw new Error("recurring submit must belong to its form");
    fireEvent.submit(recurringForm);
    await waitFor(() => {
      expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getByLabelText("Wallet").getAttribute("aria-describedby")).toBe(
      "recurring-wallet-error",
    );
    recurring.unmount();

    renderWithQuery(<AccountDeletion />);
    expect(screen.getByRole("heading", { name: "Delete account", level: 2 })).toBeTruthy();
    const deletionForm = screen
      .getByRole("button", { name: "Schedule account deletion" })
      .closest("form");
    expect(deletionForm).toBeTruthy();
    if (!deletionForm) throw new Error("deletion submit must belong to its form");
    fireEvent.submit(deletionForm);
    const password = screen.getByLabelText("Current password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(password.getAttribute("aria-describedby")).toBe("deletion-password-error");
    expect(document.getElementById("deletion-password-error")?.getAttribute("role")).toBe("alert");
  });

  it("communicates budget meaning without relying on red or green color", () => {
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
  });
});
