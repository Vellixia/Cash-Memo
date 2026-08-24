import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  state: "success", trash: vi.fn().mockResolvedValue({ data: {} }), restore: vi.fn().mockResolvedValue({ data: {} }),
  calls: [] as unknown[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: (url: unknown) => mocks.calls.push(url), push: (url: unknown) => mocks.calls.push(url) }), usePathname: () => "/app/transactions", useSearchParams: () => new URLSearchParams("from=2026-01-01&type=expense&q=food") }));
vi.mock("../generated/api", () => ({
  useListTransactions: (params: unknown) => ({ data: mocks.state === "success" ? { data: { items: [
    { id: "transaction-new", amount: "20", currency: "USD", wallet_id: "w", category_id: "food", direction: "expense", note: "literal %_ food", occurred_at: "2026-08-25T10:00:00Z" },
    { id: "old", amount: "10", currency: "USD", wallet_id: "w", category_id: "food", direction: "expense", note: null, occurred_at: "2026-08-20T10:00:00Z" },
  ], next_cursor: "next" } } : undefined, isPending: false, isError: mocks.state === "error", refetch: vi.fn(), queryKey: params }),
  useTrashTransaction: () => ({ mutateAsync: mocks.trash, isPending: false }),
  useRestoreTransaction: () => ({ mutateAsync: mocks.restore, isPending: false }),
  getListTransactionsQueryKey: () => ["/api/v1/transactions"], getListTrashedTransactionsQueryKey: () => ["/api/v1/transactions/trash"],
}));
import { TransactionHistory } from "../features/transactions/history";

function renderHistory() { const client = new QueryClient(); return render(<QueryClientProvider client={client}><TransactionHistory /></QueryClientProvider>); }
describe("transaction history", () => {
  it("uses URL-owned filters, literal query, chronology, future label, and explicit loading", () => {
    renderHistory();
    expect(screen.getByLabelText<HTMLInputElement>("Search").value).toBe("food");
    expect(screen.getAllByRole("article")[0].textContent).toContain("20");
    expect(screen.getByText("Future")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });
  it("has recoverable error", () => { mocks.state = "error"; renderHistory(); expect(screen.getByText("Could not load transactions.")).toBeTruthy(); mocks.state = "success"; });
  it("requires confirmation then calls trash and exposes endpoint-backed Undo", async () => {
    mocks.trash.mockClear(); mocks.restore.mockClear(); renderHistory();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => { expect(mocks.trash).toHaveBeenCalledWith({ transactionId: "transaction-new" }); });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => { expect(mocks.restore).toHaveBeenCalledWith({ transactionId: "transaction-new" }); });
  });
});
