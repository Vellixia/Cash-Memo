import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  month: "success",
  budgets: "success",
  recent: "success",
  monthParams: [] as unknown[],
  budgetParams: [] as unknown[],
  recentParams: [] as unknown[],
}));

vi.mock("../generated/api", () => ({
  useGetMonthlySummary: (params: unknown) => {
    api.monthParams.push(params);
    return {
      data:
        api.month === "success"
          ? {
              data: {
                month: "2026-08",
                currencies: [
                  {
                    currency: "USD",
                    income: "1200.00",
                    expense: "350.00",
                    net: "850.00",
                    expense_categories: [
                      {
                        category_id: "food",
                        name: "Food",
                        expense: "350.00",
                        share_percent: "100.00",
                      },
                    ],
                  },
                  {
                    currency: "JPY",
                    income: "5000",
                    expense: "1200",
                    net: "3800",
                    expense_categories: [
                      {
                        category_id: "travel",
                        name: "Travel",
                        expense: "1200",
                        share_percent: "100.00",
                      },
                    ],
                  },
                ],
              },
            }
          : api.month === "empty"
            ? { data: { month: "2026-08", currencies: [] } }
            : undefined,
      isPending: false,
      isError: api.month === "error",
      refetch: vi.fn(),
    };
  },
  useGetBudgetSummary: (params: unknown) => {
    api.budgetParams.push(params);
    return {
      data:
        api.budgets === "success"
          ? {
              data: {
                month: "2026-08",
                budgets: [
                  {
                    id: "budget",
                    category_id: "food",
                    currency: "USD",
                    budgeted: "300.00",
                    spent: "350.00",
                    remaining: "-50.00",
                    progress: "116.67",
                  },
                ],
              },
            }
          : undefined,
      isPending: false,
      isError: api.budgets === "error",
      refetch: vi.fn(),
    };
  },
  useGetRecentTransactions: (params: unknown) => {
    api.recentParams.push(params);
    return {
      data:
        api.recent === "success"
          ? {
              data: {
                items: [
                  {
                    id: "tx",
                    amount: "18.50",
                    currency: "USD",
                    wallet_id: "wallet",
                    category_id: "food",
                    direction: "expense",
                    note: "Lunch",
                    occurred_at: "2026-08-24T05:00:00Z",
                    deleted_at: null,
                    purge_after: null,
                    recurring_occurrence_id: null,
                  },
                ],
              },
            }
          : undefined,
      isPending: false,
      isError: api.recent === "error",
      refetch: vi.fn(),
    };
  },
}));

function view(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("dashboard", () => {
  beforeEach(() => {
    cleanup();
    api.month = "success";
    api.budgets = "success";
    api.recent = "success";
    api.monthParams.length = 0;
    api.budgetParams.length = 0;
    api.recentParams.length = 0;
  });

  it("exact money: preserves huge canonical decimals and explicit direction semantics", async () => {
    const { splitExactDecimal } = await import("../components/money/exact-decimal");
    const { MoneyAmount } = await import("../components/money/amount");
    expect(splitExactDecimal("001.20")).toBeNull();
    expect(splitExactDecimal("-1.2300")?.fraction).toBe("2300");
    view(
      <div>
        <MoneyAmount
          currency="IDR"
          value="-123456789012345678901234567890.1200"
          direction="expense"
        />
        <MoneyAmount currency="USD" value="+42.00" direction="income" />
      </div>,
    );
    expect(screen.getByText("IDR -123,456,789,012,345,678,901,234,567,890.1200")).toBeTruthy();
    expect(screen.getByText("USD +42.00")).toBeTruthy();
    expect(screen.getByText(/IDR/).getAttribute("aria-label")).toContain("Expense");
    expect(screen.getByText(/USD/).getAttribute("aria-label")).toContain("Income");
  });

  it("keeps authoritative monthly totals and categories separated by currency", async () => {
    const { Dashboard } = await import("../features/dashboard/dashboard");
    view(<Dashboard initialMonth="2026-08" />);
    expect(screen.getAllByRole("heading", { name: "USD" })).toHaveLength(2);
    expect(screen.getByText("USD 1,200.00")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "JPY" })).toBeTruthy();
    expect(screen.getByText("JPY 3,800")).toBeTruthy();
    expect(screen.getAllByText("Food")[0]?.parentElement?.textContent).toContain("USD 350.00");
    expect(screen.queryByText(/USD.*JPY.*total/i)).toBeNull();
    expect(screen.getByText("USD 18.50")).toBeTruthy();
  });

  it("renders empty dashboard and isolates endpoint failures", async () => {
    api.month = "empty";
    api.budgets = "error";
    const { Dashboard } = await import("../features/dashboard/dashboard");
    view(<Dashboard initialMonth="2026-08" />);
    expect(screen.getByText("No activity this month")).toBeTruthy();
    expect(screen.getByText("Could not load budget summary.")).toBeTruthy();
    expect(screen.getByText(/Lunch/)).toBeTruthy();
  });

  it("sends selected month to server-owned report queries", async () => {
    const { Dashboard } = await import("../features/dashboard/dashboard");
    view(<Dashboard initialMonth="2026-08" />);
    fireEvent.change(screen.getByLabelText("Reporting month"), { target: { value: "2026-07" } });
    expect(api.monthParams.at(-1)).toEqual({ month: "2026-07" });
    expect(api.budgetParams.at(-1)).toEqual({ month: "2026-07" });
    expect(api.recentParams.at(-1)).toEqual({ month: "2026-07" });
  });

  it("renders category share from server percentage and keeps currency sections independent", async () => {
    const { Dashboard } = await import("../features/dashboard/dashboard");
    view(<Dashboard initialMonth="2026-08" />);
    expect(screen.getByRole("progressbar", { name: /Food/ }).getAttribute("aria-valuenow")).toBe(
      "100",
    );
    expect(
      screen.getByRole("region", { name: "Monthly summary" }).querySelector("#currency-USD")
        ?.parentElement?.textContent,
    ).not.toContain("JPY");
  });
});
