import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  state: "success",
  trash: vi.fn().mockResolvedValue({ data: {} }),
  restore: vi.fn().mockResolvedValue({ data: {} }),
  calls: [] as unknown[],
  requestParams: [] as unknown[],
  toast: vi.fn(),
  timezoneState: ["ready"][0],
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (url: unknown) => mocks.calls.push(url),
    push: (url: unknown) => mocks.calls.push(url),
  }),
  usePathname: () => "/app/transactions",
  useSearchParams: () => new URLSearchParams("from=2026-01-01&type=expense&q=food"),
}));
vi.mock("../generated/api", () => ({
  useListTransactions: (params: unknown) => {
    mocks.requestParams.push(params);
    return {
      data:
        mocks.state === "success"
          ? {
              data: {
                items: [
                  {
                    id: "transaction-new",
                    amount: "20",
                    currency: "USD",
                    wallet_id: "w",
                    wallet_name: "Main wallet",
                    category_id: "food",
                    category_name: "Food",
                    direction: "expense",
                    note: "literal %_ food",
                    occurred_at: new Date(Date.now() + 86_400_000).toISOString(),
                  },
                  {
                    id: "old",
                    amount: "10",
                    currency: "USD",
                    wallet_id: "w",
                    wallet_name: "Main wallet",
                    category_id: "food",
                    category_name: "Food",
                    direction: "expense",
                    note: null,
                    occurred_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
                  },
                ],
                next_cursor: "next",
              },
            }
          : undefined,
      isPending: false,
      isError: mocks.state === "error",
      refetch: vi.fn(),
      queryKey: params,
    };
  },
  useTrashTransaction: () => ({ mutateAsync: mocks.trash, isPending: false }),
  useRestoreTransaction: () => ({ mutateAsync: mocks.restore, isPending: false }),
  useGetOnboarding: () => ({
    data: mocks.timezoneState === "ready"
      ? { data: { timezone: "Asia/Jakarta" } }
      : mocks.timezoneState === "invalid" ? { data: { timezone: "+05:00" } } : undefined,
    isPending: mocks.timezoneState === "pending",
    isError: mocks.timezoneState === "error",
    refetch: vi.fn(),
  }),
  getListTransactionsQueryKey: (params?: unknown) => params ? ["/api/v1/transactions", params] : ["/api/v1/transactions"],
  getListTrashedTransactionsQueryKey: () => ["/api/v1/transactions/trash"],
  getGetWalletQueryKey: (id: string) => ["/api/v1/wallets", id],
  getListWalletsQueryKey: () => ["/api/v1/wallets"],
  getListCategoriesQueryKey: () => ["/api/v1/categories"],
  getListBudgetsQueryKey: (params?: unknown) => ["/api/v1/budgets", params],
  getGetBudgetSummaryQueryKey: (params?: unknown) => ["/api/v1/reports/budget-summary", params],
  getGetMonthlySummaryQueryKey: (params?: unknown) => ["/api/v1/reports/monthly-summary", params],
}));
import { TransactionHistory, serializeHistoryFilters } from "../features/transactions/history";
import { invalidateTransactionScopes, parseCashmemoTimezone } from "../features/transactions/query-keys";

function renderHistory() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TransactionHistory />
    </QueryClientProvider>,
  );
}
describe("transaction history", () => {
  it("serializes semantic local-day filters and excludes q, invalid, or empty values", () => {
    expect(serializeHistoryFilters({ from: "2026-01-01", to: "2026-01-31", q: "food" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(serializeHistoryFilters({ from: "2026-02-31", to: "", q: "" })).toEqual({});
  });
  it("uses URL-owned filters, ephemeral query, semantic params, chronology, future label, and explicit loading", () => {
    mocks.requestParams.length = 0;
    renderHistory();
    expect(screen.getByLabelText<HTMLInputElement>("Search").value).toBe("");
    expect(mocks.requestParams.at(-1)).toMatchObject({
      from: "2026-01-01",
      type: "expense",
      q: undefined,
      cursor: undefined,
      limit: "50",
    });
    expect(screen.getAllByRole("article")[0].textContent).toContain("20");
    expect(screen.getByText("Future")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.requestParams.at(-1)).toMatchObject({ cursor: "next" });
    fireEvent.click(screen.getAllByRole("button", { name: /Actions for/ })[0]);
    expect(screen.getByRole("menuitem", { name: "Edit" }).getAttribute("href")).toBe(
      "/app/transactions/transaction-new/edit",
    );
  });
  it("has recoverable error", () => {
    mocks.state = "error";
    renderHistory();
    expect(screen.getByText("Could not load transactions.")).toBeTruthy();
    mocks.state = "success";
  });
  it("trashes without confirmation then exposes endpoint-backed Undo once", async () => {
    mocks.trash.mockClear();
    mocks.restore.mockClear();
    renderHistory();
    fireEvent.click(screen.getAllByRole("button", { name: /Actions for/ })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await waitFor(() => {
      expect(mocks.trash).toHaveBeenCalledWith({ transactionId: "transaction-new" });
    });
    expect(screen.queryByText(/Expense 20 USD/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(mocks.restore).toHaveBeenCalledWith({ transactionId: "transaction-new" });
      expect(mocks.restore).toHaveBeenCalledTimes(1);
    });
  });
  it("wires Sonner Undo to stable server restore callback and guards duplicate clicks", async () => {
    mocks.toast.mockClear();
    mocks.trash.mockClear();
    mocks.restore.mockClear();
    renderHistory();
    fireEvent.click(screen.getAllByRole("button", { name: /Actions for/ })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    const options = mocks.toast.mock.calls.at(-1)?.[1] as { action?: { onClick?: () => void } } | undefined;
    const onClick = options?.action?.onClick;
    if (!onClick) throw new Error("Sonner Undo callback missing");
    onClick();
    onClick();
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledTimes(1));
  });
  it("invalidates broad history plus targeted financial and Trash keys", async () => {
    const invalidations: unknown[] = [];
    const client = { invalidateQueries: vi.fn(async ({ queryKey }: { queryKey: unknown }) => { invalidations.push(queryKey); }) } as never;
    const timezone = parseCashmemoTimezone("Asia/Jakarta");
    if (!timezone) throw new Error("configured timezone was rejected");
    await invalidateTransactionScopes(client, {
      previous: { wallet_id: "w", category_id: "c", occurred_at: "2026-08-20T00:00:00Z" },
      timezone,
    });
    expect(invalidations).toContainEqual(["/api/v1/transactions"]);
    expect(invalidations).toContainEqual(["/api/v1/transactions/trash"]);
    expect(invalidations).toContainEqual(["/api/v1/transactions", { wallet_id: "w" }]);
  });
  it("requires validated timezone before calculating financial month scopes", async () => {
    const invalidations: unknown[] = [];
    const client = { invalidateQueries: vi.fn(async ({ queryKey }: { queryKey: unknown }) => { invalidations.push(queryKey); }) } as never;
    await expect(invalidateTransactionScopes(client, {
      previous: { wallet_id: "w", category_id: "c", occurred_at: "2026-01-31T17:00:00Z" },
    } as never)).rejects.toThrow(/timezone/i);
    expect(invalidations).toEqual([]);
    const timezone = parseCashmemoTimezone("Asia/Jakarta");
    if (!timezone) throw new Error("configured timezone was rejected");
    await invalidateTransactionScopes(client, {
      previous: { wallet_id: "w", category_id: "c", occurred_at: "2026-01-31T17:00:00Z" },
      timezone,
    });
    expect(invalidations).toContainEqual([
      "/api/v1/transactions",
      { from: "2026-02-01", to: "2026-02-28" },
    ]);
  });
  it("does not render financial dates until authenticated timezone is ready", () => {
    mocks.timezoneState = "pending";
    renderHistory();
    expect(screen.getByText("Loading timezone…")).toBeTruthy();
    expect(screen.queryByRole("time")).toBeNull();
    mocks.timezoneState = "ready";
  });
  it("accepts only backend-compatible IANA timezone identifiers", () => {
    for (const value of ["UTC", "Etc/UTC", "Asia/Jakarta", "America/New_York", "Europe/London", "Pacific/Auckland"]) {
      expect(parseCashmemoTimezone(value)).toBeTruthy();
    }
    for (const value of ["+05:00", "CET", "Asia/NotAZone", "not-a-zone"]) {
      expect(parseCashmemoTimezone(value)).toBeUndefined();
    }
  });
  it("shows invalid timezone configuration as an actionable error and recovers", () => {
    mocks.timezoneState = "invalid";
    const view = renderHistory();
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent.includes("Could not load timezone"))).toBe(true);
    expect(screen.getByRole("button", { name: "Retry timezone" })).toBeTruthy();
    mocks.timezoneState = "ready";
    view.rerender(<QueryClientProvider client={new QueryClient()}><TransactionHistory /></QueryClientProvider>);
    expect(screen.queryByText("Could not load timezone configuration.")).toBeNull();
  });
  it("keeps q ephemeral while structured filters use URL replace", () => {
    renderHistory();
    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Search"), {
      target: { value: "private note" },
    });
    expect(mocks.calls).not.toContainEqual(expect.stringContaining("q="));
    expect(mocks.requestParams.at(-1)).toMatchObject({ q: "private note" });
  });
});
