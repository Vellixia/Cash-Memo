import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({
  restore: vi.fn().mockResolvedValue({ data: {} }),
  remove: vi.fn().mockResolvedValue({}),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
vi.mock("../generated/api", () => ({
  useListTrashedTransactions: () => ({
    data: {
      data: {
        items: [
          {
            id: "gone",
            amount: "12",
            currency: "USD",
            wallet_id: "w",
            category_id: "c",
            direction: "expense",
            occurred_at: "2026-08-20T00:00:00Z",
            purge_after: "2026-09-19T00:00:00Z",
          },
        ],
        next_cursor: null,
      },
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRestoreTransaction: () => ({ mutateAsync: mocks.restore, isPending: false }),
  usePermanentlyDeleteTransaction: () => ({ mutateAsync: mocks.remove, isPending: false }),
  getListTransactionsQueryKey: () => ["/api/v1/transactions"],
  getListTrashedTransactionsQueryKey: () => ["/api/v1/transactions/trash"],
  getGetWalletQueryKey: (id: string) => ["/api/v1/wallets", id],
  getListWalletsQueryKey: () => ["/api/v1/wallets"],
  getListCategoriesQueryKey: () => ["/api/v1/categories"],
  getListBudgetsQueryKey: (params?: unknown) => ["/api/v1/budgets", params],
  getGetBudgetSummaryQueryKey: (params?: unknown) => ["/api/v1/reports/budget-summary", params],
  getGetMonthlySummaryQueryKey: (params?: unknown) => ["/api/v1/reports/monthly-summary", params],
}));
import { TransactionTrash } from "../features/transactions/trash";
function renderTrash() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TransactionTrash />
    </QueryClientProvider>,
  );
}
describe("transaction trash", () => {
  it("shows server purge date and restores transaction", async () => {
    mocks.restore.mockClear();
    renderTrash();
    expect(screen.getByText(/Purge after/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledWith({ transactionId: "gone" });
    });
  });
  it("needs explicit permanent-delete confirmation", async () => {
    mocks.remove.mockClear();
    renderTrash();
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(screen.getByText(/permanently delete/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm permanent delete" }));
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith({ transactionId: "gone" });
    });
  });
  it("keeps restored row pending and after restore rejection", async () => {
    mocks.restore.mockClear();
    const pending = deferred<{ data: object }>();
    mocks.restore.mockImplementationOnce(() => pending.promise);
    renderTrash();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledWith({ transactionId: "gone" });
    });
    expect(screen.getByRole("article")).toBeTruthy();
    pending.reject(new Error("restore unavailable"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("restore unavailable");
    });
    expect(screen.getByRole("article")).toBeTruthy();
    const succeeded = deferred<{ data: object }>();
    mocks.restore.mockImplementationOnce(() => succeeded.promise);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("article")).toBeTruthy();
    succeeded.resolve({ data: {} });
    await waitFor(() => {
      expect(screen.queryByRole("article")).toBeNull();
    });
  });
  it("keeps permanent-delete row pending and after rejection, then removes it after success", async () => {
    mocks.remove.mockClear();
    const rejected = deferred<object>();
    mocks.remove.mockImplementationOnce(() => rejected.promise);
    renderTrash();
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm permanent delete" }));
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith({ transactionId: "gone" });
    });
    expect(screen.getByRole("article")).toBeTruthy();
    rejected.reject(new Error("permanent delete unavailable"));
    await waitFor(() => {
      expect(screen.getByText("permanent delete unavailable")).toBeTruthy();
    });
    expect(screen.getByRole("article")).toBeTruthy();
    const succeeded = deferred<object>();
    mocks.remove.mockImplementationOnce(() => succeeded.promise);
    fireEvent.click(screen.getByRole("button", { name: "Confirm permanent delete" }));
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("article")).toBeTruthy();
    succeeded.resolve({});
    await waitFor(() => {
      expect(screen.queryByRole("article")).toBeNull();
    });
  });
});
