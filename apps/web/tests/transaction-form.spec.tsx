import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatUtcForTimezone, TransactionForm } from "../features/transactions/form";
import { invalidateTransactionScopes } from "../features/transactions/query-keys";
import { transactionSchema } from "../lib/validation/transaction";

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: { id: "created", wallet_id: "wallet-1", category_id: "expense", occurred_at: "2026-01-02T00:00:00Z" } }),
  update: vi.fn().mockResolvedValue({ data: { id: "edited", wallet_id: "wallet-1", category_id: "expense", occurred_at: "2026-01-02T00:00:00Z" } }),
  defaultsState: { data: [{ last_used_wallet_id: "wallet-2", timezone: "Asia/Jakarta" }, undefined].at(0), isPending: false, isError: false },
  wallets: [
    { id: "wallet-1", name: "Cash", currency: "USD", archived_at: null },
    { id: "wallet-2", name: "Bank", currency: "JPY", archived_at: null },
    { id: "wallet-3", name: "Dinar", currency: "BHD", archived_at: null },
  ] as { id: string; name: string; currency: string; archived_at: string | null }[],
  categories: [
    { id: "expense", name: "Food", kind: "expense", archived_at: null },
    { id: "income", name: "Salary", kind: "income", archived_at: null },
  ] as { id: string; name: string; kind: string; archived_at: string | null }[],
}));

vi.mock("../generated/api", () => ({
  useGetTransactionEntryDefaults: () => ({ data: mocks.defaultsState.data ? { data: mocks.defaultsState.data } : undefined, isPending: mocks.defaultsState.isPending, isError: mocks.defaultsState.isError, refetch: vi.fn() }),
  useListWallets: () => ({ data: { data: mocks.wallets }, isPending: false, isError: false, refetch: vi.fn() }),
  useListCurrencies: () => ({
    data: { data: [
      { code: "USD", display_name: "US Dollar", exponent: 2 },
      { code: "JPY", display_name: "Yen", exponent: 0 },
      { code: "BHD", display_name: "Dinar", exponent: 3 },
    ] }, isPending: false, isError: false, refetch: vi.fn(),
  }),
  useListCategories: () => ({
    data: { data: mocks.categories }, isPending: false, isError: false, refetch: vi.fn(),
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

function renderForm(transaction?: Parameters<typeof TransactionForm>[0]["transaction"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><TransactionForm transaction={transaction} /></QueryClientProvider>), client };
}

async function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const element = await screen.findByRole("option", { name: new RegExp(`^${option.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`) });
  fireEvent.pointerDown(element);
  fireEvent.pointerUp(element);
  fireEvent.click(element);
}

describe("transaction entry", () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue({ data: { id: "created", wallet_id: "wallet-1", category_id: "expense", occurred_at: "2026-01-02T00:00:00Z" } });
    mocks.update.mockReset().mockResolvedValue({ data: { id: "edited", wallet_id: "wallet-1", category_id: "expense", occurred_at: "2026-01-02T00:00:00Z" } });
    mocks.defaultsState = { data: { last_used_wallet_id: "wallet-2", timezone: "Asia/Jakarta" }, isPending: false, isError: false };
    mocks.wallets = [
      { id: "wallet-1", name: "Cash", currency: "USD", archived_at: null },
      { id: "wallet-2", name: "Bank", currency: "JPY", archived_at: null },
      { id: "wallet-3", name: "Dinar", currency: "BHD", archived_at: null },
    ];
    mocks.categories = [
      { id: "expense", name: "Food", kind: "expense", archived_at: null },
      { id: "income", name: "Salary", kind: "income", archived_at: null },
    ];
  });

  it("formats UTC through configured IANA timezone, independent of browser timezone", () => {
    expect(formatUtcForTimezone("2026-08-31T16:30:00Z", "Asia/Jakarta")).toBe("2026-08-31T23:30");
    expect(formatUtcForTimezone("2026-08-31T16:30:00Z", "America/Los_Angeles")).toBe("2026-08-31T09:30");
  });

  it("uses last-used active wallet and configured-zone local entry default", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Wallet" }).textContent).toContain("Bank"));
    expect(screen.getByLabelText<HTMLInputElement>("Occurred at").value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(document.activeElement).toBe(screen.getByLabelText("Amount"));
  });

  it("uses segmented direction and direction-compatible categories without mutating amount", async () => {
    renderForm();
    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    fireEvent.change(amount, { target: { value: "10.00" } });
    fireEvent.click(screen.getByRole("radio", { name: "Income" }));
    await choose("Category", "Salary");
    expect(amount.value).toBe("10.00");
    expect(screen.queryByRole("option", { name: /^Food$/ })).toBeNull();
  });

  it("preserves amount and reports precision error after wallet change", async () => {
    renderForm();
    await choose("Wallet", "Dinar — BHD");
    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    fireEvent.change(amount, { target: { value: "1.234" } });
    await choose("Wallet", "Bank — JPY");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("no more than 0 decimal places"));
    expect(amount.value).toBe("1.234");
  });

  it("sends exact local-minute create payload", async () => {
    renderForm();
    await choose("Wallet", "Cash — USD");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    await choose("Category", "Food");
    fireEvent.change(screen.getByLabelText("Occurred at"), { target: { value: "2026-08-31T23:30" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save transaction" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ data: {
      amount: "10", wallet_id: "wallet-1", category_id: "expense", direction: "expense", note: null,
      occurred_local: "2026-08-31T23:30",
    } }));
  });

  it("omits untouched edit occurred_local, sends it after actual dirty change", async () => {
    const transaction = {
      id: "t1", amount: "5", wallet_id: "wallet-1", wallet_name: "Cash", category_id: "expense",
      category_name: "Food", direction: "expense", note: null, currency: "USD", occurred_at: "2026-08-31T16:30:00Z",
    } as Parameters<typeof TransactionForm>[0]["transaction"];
    const view = renderForm(transaction);
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Occurred at").value).toBe("2026-08-31T23:30"));
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const untouchedCall = mocks.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(untouchedCall.data.occurred_local).toBeUndefined();
    view.unmount();
    mocks.update.mockClear();
    renderForm(transaction);
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Occurred at").value).toBe("2026-08-31T23:30"));
    fireEvent.change(screen.getByLabelText("Occurred at"), { target: { value: "2026-09-01T00:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const changedCall = mocks.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(changedCall.data.occurred_local).toBe("2026-09-01T00:00");
  });

  it("rebases RHF datetime default after delayed timezone load and omits returned value", async () => {
    mocks.defaultsState = { data: undefined, isPending: true, isError: false };
    const transaction = {
      id: "t-delayed", amount: "5", wallet_id: "wallet-1", wallet_name: "Cash", category_id: "expense",
      category_name: "Food", direction: "expense", note: null, currency: "USD", occurred_at: "2026-08-31T16:30:00Z",
    } as Parameters<typeof TransactionForm>[0]["transaction"];
    const view = renderForm(transaction);
    expect(screen.getByLabelText<HTMLInputElement>("Occurred at").value).toBe("2026-08-31T16:30");
    mocks.defaultsState = { data: { last_used_wallet_id: "wallet-2", timezone: "Asia/Jakarta" }, isPending: false, isError: false };
    view.rerender(<QueryClientProvider client={view.client}><TransactionForm transaction={transaction} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Occurred at").value).toBe("2026-08-31T23:30"));
    const occurred = screen.getByLabelText("Occurred at");
    fireEvent.change(occurred, { target: { value: "2026-09-01T00:00" } });
    fireEvent.change(occurred, { target: { value: "2026-08-31T23:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const call = mocks.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.occurred_local).toBeUndefined();
  });

  it("preserves archived wallet and category context, omitting unchanged references on note edit", async () => {
    mocks.wallets = [
      { id: "wallet-archived", name: "Old Bank", currency: "USD", archived_at: "2026-01-01T00:00:00Z" },
      { id: "wallet-1", name: "Cash", currency: "USD", archived_at: null },
    ];
    mocks.categories = [
      { id: "category-archived", name: "Old Food", kind: "expense", archived_at: "2026-01-01T00:00:00Z" },
      { id: "expense", name: "Food", kind: "expense", archived_at: null },
    ];
    const transaction = {
      id: "t-archived", amount: "5", wallet_id: "wallet-archived", wallet_name: "Old Bank", category_id: "category-archived",
      category_name: "Old Food", direction: "expense", note: null, currency: "USD", occurred_at: "2026-08-31T16:30:00Z",
    } as Parameters<typeof TransactionForm>[0]["transaction"];
    renderForm(transaction);
    expect(screen.getByRole("combobox", { name: "Wallet" }).textContent).toContain("Old Bank");
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain("Old Food");
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Historical correction" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save transaction" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    const call = mocks.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.note).toBe("Historical correction");
    expect(call.data.wallet_id).toBeUndefined();
    expect(call.data.category_id).toBeUndefined();
  });

  it("maps Rust occurred_local field error to datetime control", async () => {
    mocks.create.mockRejectedValueOnce({ response: { data: { error: {
      message: "Invalid local time", fields: { occurred_local: "This local time does not exist." },
    } } } });
    renderForm();
    await choose("Category", "Food");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Occurred at"), { target: { value: "2026-03-08T02:30" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save transaction" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save transaction" }));
    await waitFor(() => expect(screen.getByLabelText("Occurred at").getAttribute("aria-describedby")).toBe("transaction-occurred-at-error"));
    expect(screen.getByText("This local time does not exist.")).toBeTruthy();
  });

  it("validates exact local minute and note length without truncating", () => {
    const base = { amount: "1", wallet_id: "w", category_id: "c", direction: "expense" as const, note: "", occurred_at: "2026-08-24T10:00" };
    expect(transactionSchema(2).safeParse({ ...base, occurred_at: "2026-08-24T10:00:01" }).success).toBe(false);
    expect(transactionSchema(2).safeParse({ ...base, occurred_at: "2026-02-30T10:00" }).success).toBe(false);
    expect(transactionSchema(0).safeParse({ ...base, amount: "1.0" }).success).toBe(false);
    expect(transactionSchema(3).safeParse({ ...base, amount: "1.234" }).success).toBe(true);
    expect(transactionSchema(2).safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
  });

  it("invalidates report month from configured timezone, not UTC month", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    await invalidateTransactionScopes(client, {
      previous: { wallet_id: "wallet", category_id: "category", occurred_at: "2026-08-31T17:00:00Z" },
      next: { wallet_id: "wallet", category_id: "category", occurred_at: "2026-09-30T17:00:00Z" },
      timezone: "Asia/Jakarta",
    });
    const keys = spy.mock.calls.map(([query]) => query?.queryKey as unknown[]);
    expect(keys).toContainEqual(["/api/v1/reports/monthly-summary", { month: "2026-09" }]);
    expect(keys).toContainEqual(["/api/v1/reports/monthly-summary", { month: "2026-10" }]);
    expect(keys).toContainEqual(["/api/v1/budgets", { month: "2026-09" }]);
    expect(keys).toContainEqual(["/api/v1/budgets", { month: "2026-10" }]);
  });
});
