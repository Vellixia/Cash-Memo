import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listState: "success",
  walletState: "success",
  categoryState: "success",
  currencyState: "success",
  rule: {
    id: "rule",
    amount: "25.00",
    currency: "USD",
    wallet_id: "wallet",
    category_id: "food",
    direction: "expense",
    frequency: "monthly",
    start_date: "2026-08-31",
    next_due_date: "2026-09-30",
    note: "Rent share",
    status: "active",
  },
  rules: [] as Record<string, string>[],
  currencies: [{ code: "USD", display_name: "US Dollar", exponent: 2 }],
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  retryList: vi.fn(),
  retryWallets: vi.fn(),
  retryCategories: vi.fn(),
  retryCurrencies: vi.fn(),
}));

function result<T>(state: string, data: T, refetch: ReturnType<typeof vi.fn>) {
  return {
    data: state === "success" ? { data } : undefined,
    isPending: state === "loading",
    isError: state === "error",
    refetch,
  };
}

vi.mock("../generated/api", () => ({
  useListRecurringTransactions: () => result(api.listState, api.rules, api.retryList),
  useListWallets: () =>
    result(
      api.walletState,
      [
        {
          id: "wallet",
          name: "Cash",
          currency: "USD",
          opening_balance: "0.00",
          archived_at: null,
          balance: { amount: "0.00", currency: "USD", as_of: "2026-08-24T00:00:00Z" },
        },
      ],
      api.retryWallets,
    ),
  useListCategories: () =>
    result(
      api.categoryState,
      [{ id: "food", name: "Food", kind: "expense", archived_at: null }],
      api.retryCategories,
    ),
  useListCurrencies: () => result(api.currencyState, api.currencies, api.retryCurrencies),
  useCreateRecurringTransaction: () => ({ mutateAsync: api.create, isPending: false }),
  useUpdateRecurringTransaction: () => ({ mutateAsync: api.update, isPending: false }),
  useDeleteRecurringTransaction: () => ({ mutateAsync: api.remove, isPending: false }),
  usePauseRecurringTransaction: () => ({ mutateAsync: api.pause, isPending: false }),
  useResumeRecurringTransaction: () => ({ mutateAsync: api.resume, isPending: false }),
  getListRecurringTransactionsQueryKey: () => ["/api/v1/recurring-transactions"],
}));

function view(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );
}

async function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: option });
  fireEvent.pointerDown(item);
  fireEvent.pointerUp(item);
  fireEvent.click(item);
}

describe("recurring transactions", () => {
  beforeEach(() => {
    cleanup();
    api.listState = "success";
    api.walletState = "success";
    api.categoryState = "success";
    api.currencyState = "success";
    api.rules = [api.rule];
    api.currencies = [{ code: "USD", display_name: "US Dollar", exponent: 2 }];
    api.rule.status = "active";
    for (const mock of [
      api.create,
      api.update,
      api.remove,
      api.pause,
      api.resume,
      api.retryList,
      api.retryWallets,
      api.retryCategories,
      api.retryCurrencies,
    ]) {
      mock.mockReset();
      mock.mockResolvedValue({ data: {} });
    }
  });

  it("offers every cadence and creates exact server-owned recurrence input", async () => {
    const { RecurringForm } = await import("../features/recurring/recurring-form");
    view(<RecurringForm />);
    fireEvent.click(screen.getByRole("combobox", { name: "Frequency" }));
    expect(await screen.findAllByRole("option")).toHaveLength(4);
    const weekly = await screen.findByRole("option", { name: "Weekly" });
    fireEvent.pointerDown(weekly);
    fireEvent.pointerUp(weekly);
    fireEvent.click(weekly);
    expect(screen.getByText(/server calculates the next due date/i)).toBeTruthy();
    await choose("Wallet", "Cash — USD");
    await choose("Category", "Food");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Create recurring rule" }));
    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith({
        data: {
          wallet_id: "wallet",
          category_id: "food",
          direction: "expense",
          amount: "25.00",
          frequency: "weekly",
          start_date: "2026-08-31",
          note: null,
        },
      });
    });
  });

  it("edits rules without presenting upcoming rules as journal history", async () => {
    const { RecurringList } = await import("../features/recurring/recurring-list");
    view(<RecurringList />);
    expect(
      screen.getByText(/does not affect totals or history until Cashmemo generates a transaction/i),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "30.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(api.update).toHaveBeenCalledTimes(1);
    });
  });

  it("renders local date-only due dates without constructing a Date", async () => {
    const { RecurringList } = await import("../features/recurring/recurring-list");
    view(<RecurringList />);
    expect(screen.getByText(/Next due: September 30, 2026/)).toBeTruthy();
  });

  it("links required field errors and blocks unknown currency precision", async () => {
    const { RecurringForm } = await import("../features/recurring/recurring-form");
    const rendered = view(<RecurringForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create recurring rule" }));
    for (const label of ["Wallet", "Category", "Amount", "Start date"]) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBeTruthy();
    }
    expect(api.create).not.toHaveBeenCalled();
    rendered.unmount();
    api.currencies = [];
    view(<RecurringForm />);
    await choose("Wallet", "Cash — USD");
    await choose("Category", "Food");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Create recurring rule" }));
    expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/currency precision is unavailable/i)).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("gates the form on dependency loading and exposes dependency retries", async () => {
    const { RecurringForm } = await import("../features/recurring/recurring-form");
    api.walletState = "loading";
    const loading = view(<RecurringForm />);
    expect(screen.getByText("Loading recurring options…")).toBeTruthy();
    expect(screen.queryByLabelText("Amount")).toBeNull();
    loading.unmount();
    api.walletState = "error";
    api.categoryState = "error";
    api.currencyState = "error";
    view(<RecurringForm />);
    expect(screen.getByText("Could not load recurring options.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry recurring options" }));
    expect(api.retryWallets).toHaveBeenCalled();
    expect(api.retryCategories).toHaveBeenCalled();
    expect(api.retryCurrencies).toHaveBeenCalled();
  });

  it("shows list loading, error with retry, and empty states", async () => {
    const { RecurringList } = await import("../features/recurring/recurring-list");
    api.listState = "loading";
    const loading = view(<RecurringList />);
    expect(screen.getByText("Loading recurring rules…")).toBeTruthy();
    loading.unmount();
    api.listState = "error";
    const failed = view(<RecurringList />);
    expect(screen.getByText("Could not load recurring rules.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(api.retryList).toHaveBeenCalled();
    failed.unmount();
    api.listState = "success";
    api.rules = [];
    view(<RecurringList />);
    expect(screen.getByRole("heading", { name: "No recurring rules" })).toBeTruthy();
  });

  it("keeps request failures form-level and reports lifecycle failure", async () => {
    const { RecurringForm } = await import("../features/recurring/recurring-form");
    const { RecurringList } = await import("../features/recurring/recurring-list");
    api.create.mockRejectedValueOnce(new Error("create unavailable"));
    const form = view(<RecurringForm />);
    await choose("Wallet", "Cash — USD");
    await choose("Category", "Food");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25.00" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Create recurring rule" }));
    expect(await screen.findByText("create unavailable")).toBeTruthy();
    expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBeNull();
    form.unmount();
    api.pause.mockRejectedValueOnce(new Error("pause unavailable"));
    view(<RecurringList />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("pause unavailable")).toBeTruthy();
  });

  it("pauses and resumes through explicit lifecycle controls", async () => {
    const { RecurringList } = await import("../features/recurring/recurring-list");
    const rendered = view(<RecurringList />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(api.pause).toHaveBeenCalledWith({ id: "rule" });
    });
    rendered.unmount();
    api.rule.status = "paused";
    view(<RecurringList />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => {
      expect(api.resume).toHaveBeenCalledWith({ id: "rule" });
    });
  });
});
