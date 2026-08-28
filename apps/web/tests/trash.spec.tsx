import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({
  restore: vi.fn().mockResolvedValue({ data: {} }),
  remove: vi.fn().mockResolvedValue({}),
  timezoneState: ["ready"][0],
  listState: ["success"][0],
  listRefetch: vi.fn().mockResolvedValue({ data: undefined }),
  onboardingRefetch: vi.fn().mockResolvedValue({ data: undefined }),
  retryOrder: [] as string[],
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
    data: mocks.listState === "success" ? {
      data: {
        items: [
          {
            id: "gone",
            amount: "12",
            currency: "USD",
            wallet_id: "w",
            wallet_name: "Main wallet",
            category_id: "c",
            category_name: "Food",
            direction: "expense",
            occurred_at: "2026-08-19T17:00:00Z",
            deleted_at: "2026-08-19T18:00:00Z",
            purge_after: "2026-09-19T00:00:00Z",
          },
        ],
        next_cursor: null,
      },
    } : undefined,
    isPending: mocks.listState === "pending",
    isError: mocks.listState === "error",
    refetch: mocks.listRefetch,
  }),
  useGetOnboarding: () => ({
    data: mocks.timezoneState === "ready"
      ? { data: { timezone: "Asia/Jakarta" } }
      : mocks.timezoneState === "invalid" ? { data: { timezone: "+05:00" } } : undefined,
    isPending: mocks.timezoneState === "pending",
    isError: mocks.timezoneState === "error",
    refetch: mocks.onboardingRefetch,
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

function permanentDeleteAction() {
  const action = screen.getByRole("alertdialog").querySelector("button[data-slot=alert-dialog-action]");
  if (!(action instanceof HTMLElement)) throw new Error("Permanent delete action missing");
  return action;
}
describe("transaction trash", () => {
  beforeEach(() => {
    mocks.timezoneState = "ready";
    mocks.listState = "success";
    mocks.retryOrder.length = 0;
    mocks.restore.mockReset().mockResolvedValue({ data: {} });
    mocks.remove.mockReset().mockResolvedValue({});
    mocks.listRefetch.mockReset().mockResolvedValue({ data: undefined });
    mocks.onboardingRefetch.mockReset().mockResolvedValue({ data: undefined });
  });
  it("shows lifecycle dates in configured timezone and restores transaction", async () => {
    mocks.restore.mockClear();
    renderTrash();
    expect(screen.getByText(/Deleted Aug 20, 2026/)).toBeTruthy();
    expect(screen.getByText("Scheduled for automatic deletion after Sep 19, 2026.")).toBeTruthy();
    expect(screen.getByText(/Scheduled for automatic deletion after/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledWith({ transactionId: "gone" });
    });
  });
  it("gates lifecycle dates while timezone is pending or failed", () => {
    mocks.timezoneState = "pending";
    renderTrash();
    expect(screen.getByText("Loading timezone…")).toBeTruthy();
    expect(screen.queryByText(/Scheduled for automatic deletion after/)).toBeNull();
    mocks.timezoneState = "error";
    renderTrash();
    expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain("Could not load timezone");
    expect(screen.getByRole("button", { name: "Retry timezone" })).toBeTruthy();
    mocks.timezoneState = "ready";
  });
  it("shows invalid timezone configuration as an actionable error and recovers", () => {
    mocks.timezoneState = "invalid";
    const view = renderTrash();
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent.includes("Could not load timezone"))).toBe(true);
    expect(screen.getByRole("button", { name: "Retry timezone" })).toBeTruthy();
    mocks.timezoneState = "ready";
    view.rerender(<QueryClientProvider client={new QueryClient()}><TransactionTrash /></QueryClientProvider>);
    expect(screen.queryByText("Could not load timezone configuration.")).toBeNull();
  });
  it("disables Restore until timezone is valid", () => {
    mocks.timezoneState = "pending";
    const pending = renderTrash();
    expect(screen.getByRole("button", { name: "Restore" }).hasAttribute("disabled")).toBe(true);
    pending.unmount();

    mocks.timezoneState = "invalid";
    renderTrash();
    expect(screen.getByRole("button", { name: "Restore" }).hasAttribute("disabled")).toBe(true);
  });
  it("prioritizes timezone failure and one retry recovers timezone plus failed Trash", async () => {
    mocks.listState = "error";
    mocks.timezoneState = "invalid";
    mocks.onboardingRefetch.mockImplementationOnce(async () => {
      mocks.retryOrder.push("timezone");
      mocks.timezoneState = "ready";
      return { data: { data: { timezone: "Asia/Jakarta" } } };
    });
    mocks.listRefetch.mockImplementationOnce(async () => {
      mocks.retryOrder.push("trash");
      mocks.listState = "success";
      return { data: undefined };
    });
    const view = renderTrash();
    expect(screen.getByText(/Could not load timezone configuration/)).toBeTruthy();
    expect(screen.queryByText("Could not load Trash.")).toBeNull();
    expect(screen.queryByText("Trash is empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry timezone" }));
    await waitFor(() => expect(mocks.retryOrder).toEqual(["timezone", "trash"]));
    view.rerender(<QueryClientProvider client={new QueryClient()}><TransactionTrash /></QueryClientProvider>);
    expect(screen.queryByText("Could not load timezone configuration.")).toBeNull();
    expect(screen.queryByText("Could not load Trash.")).toBeNull();
  });
  it("needs explicit permanent-delete AlertDialog confirmation", async () => {
    mocks.remove.mockClear();
    renderTrash();
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(permanentDeleteAction());
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
    expect(screen.getByRole("article", { hidden: true })).toBeTruthy();
    pending.reject(new Error("restore unavailable"));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("restore unavailable");
    });
    expect(screen.getByRole("article", { hidden: true })).toBeTruthy();
    const succeeded = deferred<{ data: object }>();
    mocks.restore.mockImplementationOnce(() => succeeded.promise);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("article", { hidden: true })).toBeTruthy();
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
    fireEvent.click(permanentDeleteAction());
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith({ transactionId: "gone" });
    });
    expect(screen.getByRole("article", { hidden: true })).toBeTruthy();
    rejected.reject(new Error("permanent delete unavailable"));
    await waitFor(() => {
      expect(screen.getByText("permanent delete unavailable")).toBeTruthy();
    });
    expect(screen.getByRole("article", { hidden: true })).toBeTruthy();
    const succeeded = deferred<object>();
    mocks.remove.mockImplementationOnce(() => succeeded.promise);
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    fireEvent.click(permanentDeleteAction());
    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("article", { hidden: true })).toBeTruthy();
    succeeded.resolve({});
    await waitFor(() => {
      expect(screen.queryByRole("article")).toBeNull();
    });
  });
});
