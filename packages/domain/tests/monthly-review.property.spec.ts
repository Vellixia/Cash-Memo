import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  calculateMonthlyReview,
  type MonthlyReviewCandidate,
} from "../src/reporting/monthly-review.js";
import { previousReportingMonth, reportingMonthBounds } from "../src/time/reporting-period.js";

const SELECTED = reportingMonthBounds({
  month: "2026-03",
  reportingTimezone: "America/New_York",
});
const PRIOR = reportingMonthBounds({
  month: "2026-02",
  reportingTimezone: "America/New_York",
});

function record(overrides: Partial<MonthlyReviewCandidate> = {}): MonthlyReviewCandidate {
  return {
    amountMinor: "100",
    authority: "money_memo",
    categoryId: "10000000-0000-4000-8000-000000000001",
    categoryName: "Food",
    categoryNormalizedName: "food",
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: "2026-03-15T12:00:00Z",
    planningStatus: "planned",
    purpose: "personal",
    ...overrides,
  };
}

function calculate(records: readonly MonthlyReviewCandidate[]) {
  return calculateMonthlyReview({ priorBounds: PRIOR, records, selectedBounds: SELECTED });
}

describe("monthly review deterministic properties", () => {
  it("uses selected reporting-zone half-open month boundaries", () => {
    expect(SELECTED).toEqual({
      endExclusive: "2026-04-01T04:00:00Z",
      startInclusive: "2026-03-01T05:00:00Z",
    });
    const review = calculate([
      record({ amountMinor: "1", occurredAt: "2026-03-01T04:59:59.999Z" }),
      record({ amountMinor: "2", occurredAt: SELECTED.startInclusive }),
      record({ amountMinor: "4", occurredAt: "2026-04-01T03:59:59.999Z" }),
      record({ amountMinor: "8", occurredAt: SELECTED.endExclusive }),
    ]);
    expect(review[0]?.expenseMinor).toBe("6");
  });

  it.each([
    ["2026-01", "2025-12"],
    ["2024-03", "2024-02"],
    ["2026-03", "2026-02"],
    ["2026-05", "2026-04"],
    ["2026-08", "2026-07"],
  ])("derives calendar predecessor %s as %s", (selected, expected) => {
    expect(previousReportingMonth(selected)).toBe(expected);
  });

  it("derives prior bounds in the same DST-changing reporting timezone", () => {
    expect(PRIOR).toEqual({
      endExclusive: "2026-03-01T05:00:00Z",
      startInclusive: "2026-02-01T05:00:00Z",
    });
    expect(
      reportingMonthBounds({
        month: previousReportingMonth("2026-11"),
        reportingTimezone: "America/New_York",
      }),
    ).toEqual({
      endExclusive: "2026-11-01T04:00:00Z",
      startInclusive: "2026-10-01T04:00:00Z",
    });
  });

  it("calculates exact per-currency totals and preserves negative net", () => {
    const review = calculate([
      record({ amountMinor: "300", currency: "EUR", direction: "income" }),
      record({ amountMinor: "900", currency: "EUR" }),
      record({ amountMinor: "10000", currency: "IDR", direction: "income" }),
      record({ amountMinor: "2500", currency: "IDR" }),
      record({ amountMinor: "200", currency: "USD", direction: "income" }),
      record({ amountMinor: "50", currency: "USD" }),
    ]);
    expect(review.map((section) => section.currency)).toEqual(["EUR", "IDR", "USD"]);
    expect(
      review.map(({ expenseMinor, incomeMinor, netMinor }) => ({
        expenseMinor,
        incomeMinor,
        netMinor,
      })),
    ).toEqual([
      { expenseMinor: "900", incomeMinor: "300", netMinor: "-600" },
      { expenseMinor: "2500", incomeMinor: "10000", netMinor: "7500" },
      { expenseMinor: "50", incomeMinor: "200", netMinor: "150" },
    ]);
  });

  it("ranks expense categories by sum, normalized name, then immutable ID", () => {
    const review = calculate([
      record({
        amountMinor: "500",
        categoryId: "10000000-0000-4000-8000-000000000003",
        categoryName: "Zulu",
        categoryNormalizedName: "zulu",
      }),
      record({
        amountMinor: "500",
        categoryId: "10000000-0000-4000-8000-000000000002",
        categoryName: "Alpha later id",
        categoryNormalizedName: "alpha",
      }),
      record({
        amountMinor: "500",
        categoryId: "10000000-0000-4000-8000-000000000001",
        categoryName: "Alpha first id",
        categoryNormalizedName: "alpha",
      }),
      record({
        amountMinor: "5000",
        categoryId: "10000000-0000-4000-8000-000000000004",
        categoryName: "Income ignored",
        categoryNormalizedName: "income ignored",
        direction: "income",
      }),
    ]);
    expect(review[0]?.largestExpenseCategories.map((bucket) => bucket.key)).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
    ]);
  });

  it("keeps ranking stable for every input permutation", () => {
    const records = [
      record({ categoryId: null, categoryName: null, categoryNormalizedName: null }),
      record({
        categoryId: "10000000-0000-4000-8000-000000000002",
        categoryName: "Beta",
        categoryNormalizedName: "beta",
      }),
      record({
        categoryId: "10000000-0000-4000-8000-000000000003",
        categoryName: "Alpha",
        categoryNormalizedName: "alpha",
      }),
    ];
    const expected = calculate(records);
    fc.assert(
      fc.property(
        fc.shuffledSubarray(records, { minLength: records.length, maxLength: records.length }),
        (permutation) => {
          expect(calculate(permutation)).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sums only eligible unplanned expenses per currency", () => {
    const review = calculate([
      record({ amountMinor: "100", planningStatus: "unplanned" }),
      record({ amountMinor: "200", planningStatus: "planned" }),
      record({ amountMinor: "400", direction: "income", planningStatus: "unplanned" }),
      record({ amountMinor: "800", lifecycle: "recently_deleted", planningStatus: "unplanned" }),
      record({
        amountMinor: "1600",
        authority: "draft",
        lifecycle: "unconfirmed",
        planningStatus: "unplanned",
      }),
    ]);
    expect(review[0]?.unplannedExpenseMinor).toBe("100");
  });

  it("returns exact bounded percentage and absolute change when prior expense is nonzero", () => {
    const review = calculate([
      record({ amountMinor: "133", occurredAt: "2026-03-10T00:00:00Z" }),
      record({ amountMinor: "100", occurredAt: "2026-02-10T00:00:00Z" }),
    ]);
    expect(review[0]?.priorMonth).toEqual({
      absoluteChangeMinor: "33",
      expenseMinor: "100",
      percentageChange: "33",
      percentageUnavailableReason: null,
    });
  });

  it("rounds repeating percentage deterministically without floating point", () => {
    const review = calculate([
      record({ amountMinor: "200", occurredAt: "2026-03-10T00:00:00Z" }),
      record({ amountMinor: "300", occurredAt: "2026-02-10T00:00:00Z" }),
    ]);
    expect(review[0]?.priorMonth.percentageChange).toBe("-33.33");
  });

  it("returns absolute change and explicit reason when prior expense is zero", () => {
    const review = calculate([record({ amountMinor: "250" })]);
    expect(review[0]?.priorMonth).toEqual({
      absoluteChangeMinor: "250",
      expenseMinor: "0",
      percentageChange: null,
      percentageUnavailableReason: "PRIOR_VALUE_ZERO",
    });
    expect(JSON.stringify(review)).not.toMatch(/Infinity|NaN/u);
  });

  it("creates independent sections for selected-only and prior-only currencies", () => {
    const review = calculate([
      record({ amountMinor: "500", currency: "IDR", direction: "income" }),
      record({ amountMinor: "700", currency: "USD", occurredAt: "2026-02-10T00:00:00Z" }),
    ]);
    expect(review.map((section) => section.currency)).toEqual(["IDR", "USD"]);
    expect(review[0]).toMatchObject({
      currency: "IDR",
      expenseMinor: "0",
      incomeMinor: "500",
      priorMonth: { expenseMinor: "0" },
    });
    expect(review[1]).toMatchObject({
      currency: "USD",
      expenseMinor: "0",
      incomeMinor: "0",
      priorMonth: { expenseMinor: "700" },
    });
  });

  it("returns deterministic valid empty semantics", () => {
    expect(calculate([])).toEqual([]);
    expect(
      calculate([
        record({ lifecycle: "recently_deleted" }),
        record({ authority: "assisted_capture", lifecycle: "unconfirmed" }),
      ]),
    ).toEqual([]);
  });

  it("contains no cross-currency scalar or generated narrative fields", () => {
    const serialized = JSON.stringify(calculate([record()]));
    for (const forbidden of [
      "grandTotal",
      "totalBaseCurrency",
      "convertedTotal",
      "exchangeRate",
      "equivalentValue",
      "narrative",
      "advice",
      "prediction",
      "generatedInsight",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
