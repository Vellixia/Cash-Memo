import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ data: {} }),
  update: vi.fn().mockResolvedValue({ data: {} }),
  pause: vi.fn().mockResolvedValue({ data: {} }),
  resume: vi.fn().mockResolvedValue({ data: {} }),
}));
const rule = { id: "rule", amount: "25.00", currency: "USD", wallet_id: "wallet", category_id: "food", direction: "expense", frequency: "monthly", start_date: "2026-08-31", next_due_date: "2026-09-30", note: "Rent share", status: "active" };

vi.mock("../generated/api", () => ({
  useListRecurringTransactions: () => ({ data: { data: [rule] }, isPending: false, isError: false, refetch: vi.fn() }),
  useListWallets: () => ({ data: { data: [{ id: "wallet", name: "Cash", currency: "USD", opening_balance: "0.00", archived_at: null, balance: { amount: "0.00", currency: "USD", as_of: "2026-08-24T00:00:00Z" } }] }, isPending: false, isError: false }),
  useListCategories: () => ({ data: { data: [{ id: "food", name: "Food", kind: "expense", archived_at: null }] }, isPending: false, isError: false }),
  useListCurrencies: () => ({ data: { data: [{ code: "USD", display_name: "US Dollar", exponent: 2 }] }, isPending: false, isError: false }),
  useCreateRecurringTransaction: () => ({ mutateAsync: api.create, isPending: false }),
  useUpdateRecurringTransaction: () => ({ mutateAsync: api.update, isPending: false }),
  useDeleteRecurringTransaction: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePauseRecurringTransaction: () => ({ mutateAsync: api.pause, isPending: false }),
  useResumeRecurringTransaction: () => ({ mutateAsync: api.resume, isPending: false }),
  getListRecurringTransactionsQueryKey: () => ["/api/v1/recurring-transactions"],
}));

function view(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("recurring transactions", () => {
  beforeEach(() => { api.create.mockClear(); api.update.mockClear(); api.pause.mockClear(); api.resume.mockClear(); });

  it("offers every server cadence and explains that next occurrence is authoritative", async () => {
    const { RecurringForm } = await import("../features/recurring/recurring-form");
    view(<RecurringForm />);
    expect(Array.from(screen.getByLabelText<HTMLSelectElement>("Frequency").options).map(option => option.value)).toEqual(["daily", "weekly", "monthly", "yearly"]);
    expect(screen.getByText(/server calculates the next due date/i)).toBeTruthy();
  });

  it("creates and edits rules without presenting upcoming rules as journal history", async () => {
    const { RecurringList } = await import("../features/recurring/recurring-list");
    view(<RecurringList />);
    expect(screen.getByText(/does not affect totals or history until Cashmemo generates a transaction/i)).toBeTruthy();
    expect(screen.getByText(/Next due: September 30, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => { expect(api.update).toHaveBeenCalledWith({ id: "rule", data: { wallet_id: "wallet", category_id: "food", direction: "expense", amount: "30.00", frequency: "monthly", start_date: "2026-08-31", note: "Rent share" } }); });
  });

  it("creates a rule with selected server cadence and exact decimal text", async () => {
    const { RecurringForm } = await import("../features/recurring/recurring-form");
    view(<RecurringForm />);
    fireEvent.change(screen.getByLabelText("Wallet"), { target: { value: "wallet" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "food" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Create recurring rule" }));
    await waitFor(() => { expect(api.create).toHaveBeenCalledWith({ data: { wallet_id: "wallet", category_id: "food", direction: "expense", amount: "25.00", frequency: "weekly", start_date: "2026-08-31", note: null } }); });
  });

  it("pauses and resumes through explicit lifecycle controls", async () => {
    const { RecurringList } = await import("../features/recurring/recurring-list");
    const rendered = view(<RecurringList />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => { expect(api.pause).toHaveBeenCalledWith({ id: "rule" }); });
    rendered.unmount();
    rule.status = "paused";
    view(<RecurringList />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => { expect(api.resume).toHaveBeenCalledWith({ id: "rule" }); });
    rule.status = "active";
  });
});
