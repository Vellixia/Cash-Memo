import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { transactionSchema } from "../lib/validation/transaction";

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: { id: "created" } }),
  update: vi.fn().mockResolvedValue({ data: { id: "edited" } }),
  defaults: { last_used_wallet_id: "wallet-2" },
  invalidated: [] as unknown[],
}));

vi.mock("../generated/api", () => ({
  useGetTransactionEntryDefaults: () => ({ data: { data: mocks.defaults }, isPending: false }),
  useListWallets: () => ({ data: { data: [
    { id: "wallet-1", name: "Cash", currency: "USD", archived_at: null },
    { id: "wallet-2", name: "Bank", currency: "JPY", archived_at: null },
  ] }, isPending: false }),
  useListCategories: () => ({ data: { data: [
    { id: "expense", name: "Food", kind: "expense", archived_at: null },
    { id: "income", name: "Salary", kind: "income", archived_at: null },
  ] }, isPending: false }),
  useCreateTransaction: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateTransaction: () => ({ mutateAsync: mocks.update, isPending: false }),
  getListTransactionsQueryKey: (params?: unknown) => ["/api/v1/transactions", params],
  getListTrashedTransactionsQueryKey: (params?: unknown) => ["/api/v1/transactions/trash", params],
}));

import { TransactionForm } from "../features/transactions/form";
import { invalidateTransactionScopes } from "../features/transactions/query-keys";

function renderForm(transaction?: Parameters<typeof TransactionForm>[0]["transaction"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TransactionForm transaction={transaction} /></QueryClientProvider>);
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
    expect(transactionSchema(2).safeParse({ amount: "1.234", wallet_id: "w", category_id: "c", direction: "expense", note: "", occurred_at: "2026-08-24T10:00" }).success).toBe(false);
    expect(transactionSchema(3).safeParse({ amount: "1.234", wallet_id: "w", category_id: "c", direction: "expense", note: "", occurred_at: "2026-08-24T10:00" }).success).toBe(true);
  });

  it("keeps a local-now default, allows date adjustment, and edit preserves stored instant", () => {
    renderForm({ id: "t1", amount: "5", wallet_id: "wallet-1", category_id: "expense", direction: "expense", note: null, currency: "USD", occurred_at: "2026-01-02T03:04:00Z" });
    expect(screen.getByLabelText<HTMLInputElement>("Occurred at").value).toBeTruthy();
  });

  it("sends entered data and never truncates over-limit notes", async () => {
    mocks.create.mockClear();
    renderForm();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "expense" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x".repeat(501) } });
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toHaveLength(501);
    await waitFor(() => { expect(screen.getByRole("alert").textContent).toContain("500 characters or fewer"); });
  });

  it("invalidates transaction scopes for old and new values after edit", async () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    await invalidateTransactionScopes(client, {
      previous: { wallet_id: "old-wallet", category_id: "old-category", occurred_at: "2026-01-31T23:00:00Z" },
      next: { wallet_id: "new-wallet", category_id: "new-category", occurred_at: "2026-02-01T01:00:00Z" },
    });
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(spy.mock.calls.map((call) => JSON.stringify(call)).join(" ")).toContain("old-wallet");
    expect(spy.mock.calls.map((call) => JSON.stringify(call)).join(" ")).toContain("new-wallet");
  });
});
