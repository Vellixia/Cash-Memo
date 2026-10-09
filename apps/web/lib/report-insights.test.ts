import { describe, expect, test } from "bun:test";
import type { ReportPeriod, Trend } from "./api";
import { categoryChanges, changePercent, monthsForRange, periodTotals, topSpending, totalsFor } from "./report-insights";

const trend: Trend = {
  months: ["2025-11", "2025-12", "2026-01"],
  totals: [
    { month: "2025-11", currency: "USD", direction: "income", total_minor: 7000 },
    { month: "2025-11", currency: "USD", direction: "expense", total_minor: 4000 },
    { month: "2025-12", currency: "USD", direction: "income", total_minor: 10000 },
    { month: "2025-12", currency: "USD", direction: "expense", total_minor: 6000 },
    { month: "2026-01", currency: "USD", direction: "expense", total_minor: 9999 },
    { month: "2026-01", currency: "IDR", direction: "expense", total_minor: 100000 },
    { month: "2026-01", currency: "USD", direction: "transfer", total_minor: 50000 },
  ],
  by_category: [
    { month: "2025-11", currency: "USD", category_id: "food", total_minor: 2000 },
    { month: "2025-11", currency: "USD", category_id: "rent", total_minor: 2000 },
    { month: "2025-12", currency: "USD", category_id: "food", total_minor: 1000 },
    { month: "2025-12", currency: "USD", category_id: "rent", total_minor: 5000 },
    { month: "2026-01", currency: "USD", category_id: "food", total_minor: 2000 },
    { month: "2026-01", currency: "USD", category_id: null, total_minor: 7999 },
    { month: "2026-01", currency: "IDR", category_id: "food", total_minor: 100000 },
  ],
  scheduled: [],
};

const previous: ReportPeriod = {
  start: "2025-09-01",
  end: "2025-09-09",
  totals: [
    { currency: "USD", direction: "income", total_minor: 7000 },
    { currency: "USD", direction: "expense", total_minor: 4000 },
    { currency: "IDR", direction: "expense", total_minor: 900 },
  ],
  by_category: [
    { category_id: "food", currency: "USD", total_minor: 2000 },
    { category_id: "rent", currency: "USD", total_minor: 2000 },
    { category_id: "gone", currency: "USD", total_minor: 500 },
    { category_id: "food", currency: "IDR", total_minor: 900 },
  ],
};
const current: ReportPeriod = {
  start: "2025-10-01",
  end: "2025-10-09",
  totals: [{ currency: "USD", direction: "expense", total_minor: 9500 }],
  by_category: [
    { category_id: "food", currency: "USD", total_minor: 1000 },
    { category_id: "rent", currency: "USD", total_minor: 5000 },
    { category_id: null, currency: "USD", total_minor: 3500 },
  ],
};

describe("report periods", () => {
  test("period totals stay in the chosen currency", () => {
    expect(periodTotals(previous, "USD")).toEqual({ income: 7000, expense: 4000, net: 3000 });
    expect(periodTotals(current, "USD")).toEqual({ income: 0, expense: 9500, net: -9500 });
    expect(periodTotals(current, "IDR")).toEqual({ income: 0, expense: 0, net: 0 });
  });

  test("selected range totals stay in chosen currency and exclude transfers", () => {
    expect(monthsForRange(trend, "month")).toEqual(["2026-01"]);
    expect(monthsForRange(trend, "3")).toHaveLength(3);
    expect(totalsFor(trend, "USD", monthsForRange(trend, "month"))).toEqual({ income: 0, expense: 9999, net: -9999 });
    expect(totalsFor(trend, "IDR", monthsForRange(trend, "month"))).toEqual({ income: 0, expense: 100000, net: -100000 });
    expect(totalsFor(trend, "USD", monthsForRange(trend, "3"))).toEqual({ income: 17000, expense: 19999, net: -2999 });
  });
});

describe("category insights", () => {
  test("sort by absolute change and handle disappearing and new categories", () => {
    const rows = categoryChanges(previous, current, "USD");
    expect(rows.map((r) => [r.key, r.delta, r.percent])).toEqual([
      ["uncategorized", 3500, null],
      ["rent", 3000, 150],
      ["food", -1000, -50],
      ["gone", -500, -100],
    ]);
    // Other currencies never leak in; a category absent now is a full decrease.
    expect(categoryChanges(previous, current, "IDR").map((r) => [r.key, r.delta])).toEqual([["food", -900]]);
    expect(changePercent(0, 500)).toBeNull();
    expect(changePercent(100, 0)).toBe(-100);
    expect(changePercent(-100, 100)).toBeNull();
  });

  test("top spending shares only selected months and currency; includes uncategorized", () => {
    expect(topSpending(trend, "USD", ["2026-01"]).map(({ key, amount, share }) => [key, amount, share]))
      .toEqual([["uncategorized", 7999, 80], ["food", 2000, 20]]);
    expect(topSpending(trend, "USD", ["2025-11"]).map((r) => r.share)).toEqual([50, 50]);
    expect(topSpending(trend, "USD", []).length).toBe(0);
  });
});
