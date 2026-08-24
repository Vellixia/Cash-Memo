import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { transactionSchema } from "../lib/validation/transaction";

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: { id: "created" } }),
  update: vi.fn().mockResolvedValue({ data: { id: "edited" } }),
  defaults: { last_used_wallet_id: ["wallet-2", null][0] },
  wallets: [
    { id: "wallet-1", name: "Cash", currency: "USD", archived_at: null },
    { id: "wallet-2", name: "Bank", currency: "JPY", archived_at: null },
    { id: "wallet-3", name: "Dinar", currency: "BHD", archived_at: null },
    { id: "wallet-4", name: "Fund", currency: "CLF", archived_at: null },
  ] as { id: string; name: string; currency: string; archived_at: string | null }[],
  invalidated: [] as unknown[],
}));

vi.mock("../generated/api", () => ({
  useGetTransactionEntryDefaults: () => ({ data: { data: mocks.defaults }, isPending: false }),
  useListWallets: () => ({ data: { data: mocks.wallets }, isPending: false }),
  useListCurrencies: () => ({
    data: {
      data: [
        { code: "USD", display_name: "US Dollar", exponent: 2 },
        { code: "JPY", display_name: "Yen", exponent: 0 },
        { code: "BHD", display_name: "Dinar", exponent: 3 },
        { code: "CLF", display_name: "Fund", exponent: 4 },
      ],
    },
    isPending: false,
  }),
  useListCategories: () => ({
    data: {
      data: [
        { id: "expense", name: "Food", kind: "expense", archived_at: null },
        { id: "income", name: "Salary", kind: "income", archived_at: null },
      ],
    },
    isPending: false,
  }),
  useCreateTransaction: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: mocks.update, isPending: false }),
  getListTransactionsQueryKey: (params?: unknown) => ["/api/v1/transactions", params],
  getListTrashedTransactionsQueryKey: (params?: unknown) => ["/api/v1/transactions/trash", params],
  getListWalletsQueryKey: () => ["/api/v1/wallets"],
  getGetWalletQueryKey: (id: string) => ["/api/v1/wallets", id],
  getListCategoriesQueryKey: () => ["/api/v1/categories"],
  getListBudgetsQueryKey: (params?: unknown) => ["/api/v1/budgets", params],
  getGetBudgetSummaryQueryKey: (params?: unknown) => ["/api/v1/reports/budget-summary", params],
  getGetMonthlySummaryQueryKey: (params?: unknown) => ["/api/v1/reports/monthly-summary", params],
}));

import { TransactionForm } from "../features/transactions/form";
import { invalidateTransactionScopes } from "../features/transactions/query-keys";

function renderForm(transaction?: Parameters<typeof TransactionForm>[0]["transaction"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TransactionForm transaction={transaction} />
    </QueryClientProvider>,
  );
}

describe("transaction entry", () => {
  it("uses server last-used active wallet, expense default, and amount first", () => {
    renderForm();
    expect(screen.getByLabelText<HTMLSelectElement>("Wallet").value).toBe("wallet-2");
    expect(screen.getByLabelText<HTMLSelectElement>("Direction").value).toBe("expense");
    expect(document.activeElement).toBe(screen.getByLabelText("Amount"));
  });

  it("switches category choices for income without mutating amount", () => {
    renderForm();
    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    fireEvent.change(amount, { target: { value: "10.00" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "income" } });
    expect(screen.getByRole("option", { name: "Salary" })).toBeTruthy();
    expect(amount.value).toBe("10.00");
  });

  it("validates wallet currency exponent and preserves invalid text", () => {
    expect(
      transactionSchema(0).safeParse({
        amount: "1.0",
        wallet_id: "w",
        category_id: "c",
        direction: "expense",
        note: "",
        occurred_at: "2026-08-24T10:00",
      }).success,
    ).toBe(false);
    expect(
      transactionSchema(2).safeParse({
        amount: "1.234",
        wallet_id: "w",
        category_id: "c",
        direction: "expense",
        note: "",
        occurred_at: "2026-08-24T10:00",
      }).success,
    ).toBe(false);
    expect(
      transactionSchema(3).safeParse({
        amount: "1.234",
        wallet_id: "w",
        category_id: "c",
        direction: "expense",
        note: "",
        occurred_at: "2026-08-24T10:00",
      }).success,
    ).toBe(true);
    expect(
      transactionSchema(4).safeParse({
        amount: "1.2345",
        wallet_id: "w",
        category_id: "c",
        direction: "expense",
        note: "",
        occurred_at: "2026-08-24T10:00",
      }).success,
    ).toBe(true);
  });

  it("uses generated currency precision after wallet change without changing amount", async () => {
    renderForm();
    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    fireEvent.change(amount, { target: { value: "1.234" } });
    fireEvent.change(screen.getByLabelText("Wallet"), { target: { value: "wallet-3" } });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    fireEvent.change(screen.getByLabelText("Wallet"), { target: { value: "wallet-4" } });
    expect(amount.value).toBe("1.234");
  });

  it("uses sole active wallet but leaves wallet required when no server default or sole wallet exists", () => {
    mocks.defaults.last_used_wallet_id = null;
    mocks.wallets = [{ id: "only", name: "Only", currency: "USD", archived_at: null }];
    const sole = renderForm();
    expect(screen.getByLabelText<HTMLSelectElement>("Wallet").value).toBe("only");
    sole.unmount();
    mocks.wallets = [
      { id: "a", name: "A", currency: "USD", archived_at: null },
      { id: "b", name: "B", currency: "USD", archived_at: null },
    ];
    renderForm();
    expect(screen.getByLabelText<HTMLSelectElement>("Wallet").value).toBe("");
    mocks.defaults.last_used_wallet_id = "wallet-2";
    mocks.wallets = [
      { id: "wallet-1", name: "Cash", currency: "USD", archived_at: null },
      { id: "wallet-2", name: "Bank", currency: "JPY", archived_at: null },
      { id: "wallet-3", name: "Dinar", currency: "BHD", archived_at: null },
      { id: "wallet-4", name: "Fund", currency: "CLF", archived_at: null },
    ];
  });

  it("keeps a local-now default, allows date adjustment, and edit preserves stored instant", () => {
    renderForm({
      id: "t1",
      amount: "5",
      wallet_id: "wallet-1",
      category_id: "expense",
      direction: "expense",
      note: null,
      currency: "USD",
      occurred_at: "2026-01-02T03:04:00Z",
    });
    expect(screen.getByLabelText<HTMLInputElement>("Occurred at").value).toBeTruthy();
  });

  it("sends entered data and never truncates over-limit notes", async () => {
    mocks.create.mockClear();
    renderForm();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "expense" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x".repeat(501) } });
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toHaveLength(501);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("500 characters or fewer");
    });
  });

  it("sends exact create payload and preserves untouched edit instant", async () => {
    mocks.create.mockClear();
    mocks.update.mockClear();
    const created = renderForm();
    fireEvent.change(screen.getByLabelText("Wallet"), { target: { value: "wallet-2" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "expense" } });
    fireEvent.change(screen.getByLabelText("Occurred at"), {
      target: { value: "2026-01-02T03:04" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save transaction" })).toHaveProperty(
        "disabled",
        false,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          amount: "10",
          wallet_id: "wallet-2",
          category_id: "expense",
          direction: "expense",
          note: null,
          occurred_at: new Date("2026-01-02T03:04").toISOString(),
        },
      });
    });
    created.unmount();
    renderForm({
      id: "t1",
      amount: "5",
      wallet_id: "wallet-1",
      category_id: "expense",
      direction: "expense",
      note: null,
      currency: "USD",
      occurred_at: "2026-01-02T03:04:00Z",
    });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith({
        transactionId: "t1",
        data: {
          amount: "5",
          wallet_id: "wallet-1",
          category_id: "expense",
          direction: "expense",
          note: null,
          occurred_at: "2026-01-02T03:04:00Z",
        },
      });
    });
  });

  it("invalidates transaction scopes for old and new values after edit", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    await invalidateTransactionScopes(client, {
      previous: {
        wallet_id: "old-wallet",
        category_id: "old-category",
        occurred_at: "2026-01-31T23:00:00Z",
      },
      next: {
        wallet_id: "new-wallet",
        category_id: "new-category",
        occurred_at: "2026-02-01T01:00:00Z",
      },
    });
    const keys = spy.mock.calls.map(([input]) => input?.queryKey);
    expect(keys).toContainEqual(["/api/v1/wallets", "old-wallet"]);
    expect(keys).toContainEqual(["/api/v1/wallets", "new-wallet"]);
    expect(keys).toContainEqual(["/api/v1/reports/budget-summary", { month: "2026-01" }]);
    expect(keys).toContainEqual(["/api/v1/reports/monthly-summary", { month: "2026-02" }]);
  });
});
