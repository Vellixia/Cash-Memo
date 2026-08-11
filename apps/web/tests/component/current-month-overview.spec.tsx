import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  JournalApiError,
  type CurrentMonthOverviewView,
  type JournalApiPort,
} from "../../src/app/journal-api.js";
import { CurrentMonthOverview } from "../../src/features/reporting/CurrentMonthOverview.js";

const populated: CurrentMonthOverviewView = {
  calculatedAt: "2026-08-11T00:00:00Z",
  currencies: [
    {
      categoryBreakdown: [{ amountMinor: "10050", key: "salary", label: "Salary" }],
      currency: "IDR",
      currencyExponent: 2,
      expenseMinor: "250",
      incomeMinor: "10050",
      netMinor: "9800",
      planningBreakdown: [{ amountMinor: "10300", key: "planned", label: "Planned" }],
      purposeBreakdown: [{ amountMinor: "10300", key: "work", label: "Work" }],
    },
    {
      categoryBreakdown: [{ amountMinor: "500", key: "food", label: "Food" }],
      currency: "USD",
      currencyExponent: 2,
      expenseMinor: "500",
      incomeMinor: "0",
      netMinor: "-500",
      planningBreakdown: [{ amountMinor: "500", key: "unplanned", label: "Unplanned" }],
      purposeBreakdown: [{ amountMinor: "500", key: "personal", label: "Personal" }],
    },
  ],
  period: "2026-08",
  recentMemos: [
    {
      direction: "expense",
      id: "30000000-0000-4000-8000-000000000081",
      money: { amountMinor: "500", currency: "USD", currencyExponent: 2 },
      note: null,
      occurrence: { occurredAt: "2026-08-10T00:00:00Z" },
    },
  ],
  reportingTimezone: "Asia/Jakarta",
};

function api(getCurrentMonth: JournalApiPort["getCurrentMonth"]): JournalApiPort {
  const unsupported = async () => {
    throw new Error("Unsupported in current-month component fixture");
  };
  return {
    createCategory: unsupported,
    createMoneySpace: unsupported,
    getCurrentMonth,
    getMonthlyReview: unsupported,
    listCategories: unsupported,
    listMoneySpaces: unsupported,
    search: unsupported,
    updateCategory: unsupported,
    updateMoneySpace: unsupported,
  };
}

describe("current-month overview UI", () => {
  it("shows loading while the private authenticated request is pending", () => {
    render(
      <CurrentMonthOverview
        api={api(vi.fn(() => new Promise<CurrentMonthOverviewView>(() => undefined)))}
      />,
    );
    expect(screen.getByTestId("current-month-loading")).toBeInTheDocument();
  });

  it("renders exact independent currency sections, buckets, and recent active memos", async () => {
    render(<CurrentMonthOverview api={api(vi.fn(async () => populated))} />);
    expect(await screen.findByTestId("current-month-currency-IDR")).toBeInTheDocument();
    expect(screen.getByTestId("current-month-currency-USD")).toBeInTheDocument();
    expect(screen.getByTestId("IDR-income")).toHaveTextContent("IDR 100.50");
    expect(screen.getByTestId("USD-net")).toHaveTextContent("USD -5.00");
    expect(screen.getByText("Salary")).toBeInTheDocument();
    expect(screen.getByTestId("current-month-recent-memos")).toHaveTextContent("USD 5.00");
    expect(
      screen.queryByText(/grand total|net worth|converted|exchange rate/iu),
    ).not.toBeInTheDocument();
  });

  it("distinguishes honest zero activity from calculation failure", async () => {
    render(
      <CurrentMonthOverview
        api={api(vi.fn(async () => ({ ...populated, currencies: [], recentMemos: [] })))}
      />,
    );
    expect(await screen.findByTestId("current-month-empty")).toHaveTextContent(
      "No activity this month",
    );
    expect(screen.queryByTestId("current-month-unavailable")).not.toBeInTheDocument();
  });

  it("keeps recent active memos separate when current-month financial activity is empty", async () => {
    render(
      <CurrentMonthOverview api={api(vi.fn(async () => ({ ...populated, currencies: [] })))} />,
    );
    expect(await screen.findByTestId("current-month-empty")).toBeInTheDocument();
    expect(screen.getByTestId("current-month-recent-memos")).toHaveTextContent("USD 5.00");
  });

  it("shows calculation unavailable without stale or partial values", async () => {
    render(
      <CurrentMonthOverview
        api={api(
          vi.fn(async () => {
            throw new JournalApiError("CURRENT_MONTH_CALCULATION_UNAVAILABLE", true);
          }),
        )}
      />,
    );
    expect(await screen.findByTestId("current-month-unavailable")).toHaveTextContent(
      "Current-month calculation unavailable",
    );
    expect(screen.queryByTestId("current-month-currencies")).not.toBeInTheDocument();
  });

  it("shows network failure separately from unavailable calculation", async () => {
    render(
      <CurrentMonthOverview
        api={api(
          vi.fn(async () => {
            throw new JournalApiError("NETWORK_ERROR", true);
          }),
        )}
      />,
    );
    expect(await screen.findByTestId("current-month-network-error")).toBeInTheDocument();
    expect(screen.queryByTestId("current-month-unavailable")).not.toBeInTheDocument();
  });
});
