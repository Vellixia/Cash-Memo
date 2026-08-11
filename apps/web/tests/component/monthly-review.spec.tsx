import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  JournalApiError,
  type JournalApiPort,
  type MonthlyReviewView,
} from "../../src/app/journal-api.js";
import { MonthlyReview } from "../../src/features/reporting/MonthlyReview.js";

const populated: MonthlyReviewView = {
  calculatedAt: "2026-03-20T12:00:00Z",
  currencies: [
    {
      currency: "EUR",
      currencyExponent: 2,
      expenseMinor: "2500",
      incomeMinor: "1000",
      largestExpenseCategories: [{ amountMinor: "2500", key: "beta", label: "Beta" }],
      netMinor: "-1500",
      priorMonth: {
        absoluteChangeMinor: "2500",
        expenseMinor: "0",
        percentageChange: null,
        percentageUnavailableReason: "PRIOR_VALUE_ZERO",
      },
      unplannedExpenseMinor: "2500",
    },
    {
      currency: "USD",
      currencyExponent: 2,
      expenseMinor: "7000",
      incomeMinor: "10000",
      largestExpenseCategories: [
        { amountMinor: "3000", key: "alpha", label: "Alpha" },
        { amountMinor: "3000", key: "beta", label: "Beta" },
      ],
      netMinor: "3000",
      priorMonth: {
        absoluteChangeMinor: "2000",
        expenseMinor: "5000",
        percentageChange: "40",
        percentageUnavailableReason: null,
      },
      unplannedExpenseMinor: "4000",
    },
  ],
  month: "2026-03",
  priorMonth: "2026-02",
  reportingTimezone: "America/New_York",
};

function api(getMonthlyReview: JournalApiPort["getMonthlyReview"]): JournalApiPort {
  const unsupported = async () => {
    throw new Error("Unsupported in monthly-review component fixture");
  };
  return {
    createCategory: unsupported,
    createMoneySpace: unsupported,
    getCurrentMonth: unsupported,
    getMonthlyReview,
    listCategories: unsupported,
    listMoneySpaces: unsupported,
    search: unsupported,
    updateCategory: unsupported,
    updateMoneySpace: unsupported,
  };
}

describe("monthly review UI", () => {
  it("shows loading for the private authenticated request", () => {
    render(
      <MonthlyReview
        api={api(vi.fn(() => new Promise<MonthlyReviewView>(() => undefined)))}
        initialMonth="2026-03"
      />,
    );
    expect(screen.getByTestId("monthly-review-loading")).toBeInTheDocument();
  });

  it("renders independent currencies, negative net, ranking ties, and exact comparison", async () => {
    render(<MonthlyReview api={api(vi.fn(async () => populated))} initialMonth="2026-03" />);
    expect(await screen.findByTestId("monthly-review-currency-EUR")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-review-currency-USD")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-EUR-net")).toHaveTextContent("EUR -15.00");
    expect(screen.getByTestId("monthly-USD-percentage")).toHaveTextContent("40%");
    expect(screen.getByTestId("monthly-USD-categories").textContent).toMatch(/Alpha.*Beta/u);
    expect(screen.queryByText(/grand total|converted|base currency|net worth/iu)).toBeNull();
  });

  it("explains prior zero without Infinity, NaN, or fabricated percentage", async () => {
    render(<MonthlyReview api={api(vi.fn(async () => populated))} initialMonth="2026-03" />);
    expect(await screen.findByTestId("monthly-EUR-prior-zero")).toHaveTextContent(
      "Percentage comparison unavailable because prior-month expenses were zero.",
    );
    expect(screen.getByTestId("monthly-EUR-absolute-change")).toHaveTextContent("EUR 25.00");
    expect(screen.queryByText(/Infinity|NaN|100%/u)).toBeNull();
  });

  it("loads a newly selected canonical month", async () => {
    const getMonthlyReview = vi.fn(async () => populated);
    render(<MonthlyReview api={api(getMonthlyReview)} initialMonth="2026-03" />);
    await screen.findByTestId("monthly-review-currency-USD");
    fireEvent.change(screen.getByLabelText("Calendar month"), { target: { value: "2026-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Review month" }));
    await waitFor(() => expect(getMonthlyReview).toHaveBeenLastCalledWith("2026-04"));
  });

  it("distinguishes valid empty month from calculation unavailable", async () => {
    render(
      <MonthlyReview
        api={api(vi.fn(async () => ({ ...populated, currencies: [] })))}
        initialMonth="2026-03"
      />,
    );
    expect(await screen.findByTestId("monthly-review-empty")).toHaveTextContent(
      "No activity in this month",
    );
    expect(screen.queryByTestId("monthly-review-unavailable")).toBeNull();
  });

  it("clears financial values when calculation becomes unavailable", async () => {
    const getMonthlyReview = vi
      .fn<JournalApiPort["getMonthlyReview"]>()
      .mockResolvedValueOnce(populated)
      .mockRejectedValueOnce(new JournalApiError("MONTHLY_REVIEW_CALCULATION_UNAVAILABLE", true));
    render(<MonthlyReview api={api(getMonthlyReview)} initialMonth="2026-03" />);
    await screen.findByTestId("monthly-review-currency-USD");
    fireEvent.click(screen.getByRole("button", { name: "Review month" }));
    expect(await screen.findByTestId("monthly-review-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("monthly-review-currencies")).toBeNull();
    expect(screen.queryByText("USD 100.00")).toBeNull();
  });

  it("shows network failure separately", async () => {
    render(
      <MonthlyReview
        api={api(
          vi.fn(async () => {
            throw new JournalApiError("NETWORK_ERROR", true);
          }),
        )}
        initialMonth="2026-03"
      />,
    );
    expect(await screen.findByTestId("monthly-review-network-error")).toBeInTheDocument();
    expect(screen.queryByTestId("monthly-review-unavailable")).toBeNull();
  });
});
