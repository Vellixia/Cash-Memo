import { describe, expect, test } from "bun:test";
import type { Trend } from "./api";
import { categoryChanges, changePercent, completedComparisonMonths, monthsForRange, topSpending, totalsFor } from "./report-insights";

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
};

describe("report periods", () => {
  test("full-month comparison excludes current partial month across year boundary", () => {
    expect(completedComparisonMonths(trend)).toEqual({ previous: "2025-11", current: "2025-12" });
    expect(completedComparisonMonths({ ...trend, months: ["2026-02", "2026-03", "2026-04"] }))
      .toEqual({ previous: "2026-02", current: "2026-03" });
    expect(completedComparisonMonths({ ...trend, months: ["2024-12", "2025-01", "2025-02"] }))
      .toEqual({ previous: "2024-12", current: "2025-01" });
    expect(completedComparisonMonths({ ...trend, months: ["2026-02", "2026-03"] })).toBeNull();
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
    const rows = categoryChanges(trend, "USD", "2025-11", "2025-12");
    expect(rows.map((r) => [r.key, r.delta, r.percent])).toEqual([
      ["rent", 3000, 150],
      ["food", -1000, -50],
    ]);
    expect(categoryChanges(trend, "USD", "2025-12", "2026-01").find((r) => r.key === "uncategorized")?.percent).toBeNull();
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
