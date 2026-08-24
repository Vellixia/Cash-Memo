import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({
  restore: vi.fn().mockResolvedValue({ data: {} }),
  remove: vi.fn().mockResolvedValue({}),
}));
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
});
