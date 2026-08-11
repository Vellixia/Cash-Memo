import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  calculateCurrentMonth,
  type CurrentMonthCandidate,
} from "../src/reporting/current-month.js";
import { reportingMonthBounds } from "../src/time/reporting-period.js";

const MARCH_NEW_YORK = reportingMonthBounds({
  month: "2026-03",
  reportingTimezone: "America/New_York",
});

function record(overrides: Partial<CurrentMonthCandidate> = {}): CurrentMonthCandidate {
  return {
    amountMinor: "100",
    authority: "money_memo",
    categoryId: "10000000-0000-4000-8000-000000000001",
    categoryName: "Food",
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    lifecycle: "active",
    moneySpaceId: "20000000-0000-4000-8000-000000000001",
    occurredAt: "2026-03-15T12:00:00Z",
    planningStatus: "planned",
    purpose: "personal",
    ...overrides,
  };
}

function calculate(records: readonly CurrentMonthCandidate[]) {
  return calculateCurrentMonth({ bounds: MARCH_NEW_YORK, records });
}

describe("current-month deterministic overview properties", () => {
  it("sums income, expense, and net exactly per currency", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountMinor: fc.bigInt({ min: 1n, max: 9_999_999_999_999_999n }),
            direction: fc.constantFrom<"expense" | "income">("expense", "income"),
          }),
          { minLength: 1, maxLength: 100 },
        ),
        (values) => {
          const overview = calculate(
            values.map((value) =>
              record({ amountMinor: value.amountMinor.toString(), direction: value.direction }),
            ),
          );
          const expectedIncome = values
            .filter((value) => value.direction === "income")
            .reduce((sum, value) => sum + value.amountMinor, 0n);
          const expectedExpense = values
            .filter((value) => value.direction === "expense")
            .reduce((sum, value) => sum + value.amountMinor, 0n);
          expect(overview).toHaveLength(1);
          expect(overview[0]).toMatchObject({
            expenseMinor: expectedExpense.toString(),
            incomeMinor: expectedIncome.toString(),
            netMinor: (expectedIncome - expectedExpense).toString(),
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  it("returns independent deterministic IDR, USD, and EUR currency sections", () => {
    const overview = calculate([
      record({ amountMinor: "900", currency: "USD", direction: "income" }),
      record({ amountMinor: "400", currency: "USD" }),
      record({ amountMinor: "8000", currency: "IDR", direction: "income" }),
      record({ amountMinor: "9000", currency: "IDR" }),
      record({ amountMinor: "700", currency: "EUR", direction: "income" }),
      record({ amountMinor: "200", currency: "EUR" }),
    ]);

    expect(overview.map((section) => section.currency)).toEqual(["EUR", "IDR", "USD"]);
    expect(
      overview.map(({ expenseMinor, incomeMinor, netMinor }) => ({
        expenseMinor,
        incomeMinor,
        netMinor,
      })),
    ).toEqual([
      { expenseMinor: "200", incomeMinor: "700", netMinor: "500" },
      { expenseMinor: "9000", incomeMinor: "8000", netMinor: "-1000" },
      { expenseMinor: "400", incomeMinor: "900", netMinor: "500" },
    ]);
    const serialized = JSON.stringify(overview);
    for (const forbidden of [
      "grandTotal",
      "totalBaseCurrency",
      "convertedTotal",
      "exchangeRate",
      "equivalentValue",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    ["active confirmed", "money_memo", "active", true],
    ["archived confirmed", "money_memo", "archived", true],
    ["Recently Deleted", "money_memo", "recently_deleted", false],
    ["purging", "money_memo", "purging", false],
    ["purged", "money_memo", "purged", false],
    ["draft", "draft", "unconfirmed", false],
    ["assisted intermediate", "assisted_capture", "unconfirmed", false],
  ] as const)("applies %s eligibility", (_name, authority, lifecycle, included) => {
    const overview = calculate([record({ authority, lifecycle })]);
    expect(overview.length > 0).toBe(included);
  });

  it("partitions every eligible magnitude exactly once in each defined bucket dimension", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountMinor: fc.bigInt({ min: 1n, max: 1_000_000n }),
            category: fc.option(fc.constantFrom("Food", "Travel", "Salary"), { nil: null }),
            planning: fc.option(fc.constantFrom<"planned" | "unplanned">("planned", "unplanned"), {
              nil: null,
            }),
            purpose: fc.option(
              fc.constantFrom<"mixed" | "personal" | "work">("mixed", "personal", "work"),
              {
                nil: null,
              },
            ),
          }),
          { minLength: 1, maxLength: 100 },
        ),
        (values) => {
          const overview = calculate(
            values.map((value, index) =>
              record({
                amountMinor: value.amountMinor.toString(),
                categoryId:
                  value.category === null
                    ? null
                    : `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
                categoryName: value.category,
                planningStatus: value.planning,
                purpose: value.purpose,
              }),
            ),
          );
          const section = overview[0];
          expect(section).toBeDefined();
          const gross = values.reduce((sum, value) => sum + value.amountMinor, 0n);
          for (const buckets of [
            section?.categoryBreakdown ?? [],
            section?.planningBreakdown ?? [],
            section?.purposeBreakdown ?? [],
          ]) {
            expect(buckets.reduce((sum, bucket) => sum + BigInt(bucket.amountMinor), 0n)).toBe(
              gross,
            );
          }
        },
      ),
      { numRuns: 250 },
    );
  });

  it("keeps uncategorized, no Money Space, and unset values without dropping money", () => {
    const overview = calculate([
      record({
        amountMinor: "321",
        categoryId: null,
        categoryName: null,
        moneySpaceId: null,
        planningStatus: null,
        purpose: null,
      }),
    ]);
    expect(overview[0]).toMatchObject({ expenseMinor: "321", netMinor: "-321" });
    expect(overview[0]?.categoryBreakdown).toEqual([
      { amountMinor: "321", key: "uncategorized", label: "Uncategorized" },
    ]);
    expect(overview[0]?.planningBreakdown).toEqual([
      { amountMinor: "321", key: "unspecified", label: "Unspecified" },
    ]);
    expect(overview[0]?.purposeBreakdown).toEqual([
      { amountMinor: "321", key: "unspecified", label: "Unspecified" },
    ]);
  });

  it("uses reporting-zone half-open boundaries across a DST-changing month", () => {
    expect(MARCH_NEW_YORK).toEqual({
      endExclusive: "2026-04-01T04:00:00Z",
      startInclusive: "2026-03-01T05:00:00Z",
    });
    const overview = calculate([
      record({ amountMinor: "1", occurredAt: "2026-03-01T04:59:59.999Z" }),
      record({ amountMinor: "2", occurredAt: MARCH_NEW_YORK.startInclusive }),
      record({ amountMinor: "4", occurredAt: "2026-04-01T03:59:59.999Z" }),
      record({ amountMinor: "8", occurredAt: MARCH_NEW_YORK.endExclusive }),
    ]);
    expect(overview[0]?.expenseMinor).toBe("6");
  });

  it("uses reporting timezone rather than UTC month boundaries", () => {
    const jakarta = reportingMonthBounds({
      month: "2026-08",
      reportingTimezone: "Asia/Jakarta",
    });
    const overview = calculateCurrentMonth({
      bounds: jakarta,
      records: [
        record({ amountMinor: "10", occurredAt: "2026-07-31T16:59:59.999Z" }),
        record({ amountMinor: "20", occurredAt: "2026-07-31T17:00:00Z" }),
        record({ amountMinor: "40", occurredAt: "2026-08-31T16:59:59.999Z" }),
        record({ amountMinor: "80", occurredAt: "2026-08-31T17:00:00Z" }),
      ],
    });
    expect(overview[0]?.expenseMinor).toBe("60");
  });

  it("retains exact integer sums beyond JavaScript safe-number range", () => {
    const overview = calculate([
      record({ amountMinor: "9223372036854775807", direction: "income" }),
      record({ amountMinor: "9223372036854775807", direction: "income" }),
      record({ amountMinor: "9007199254740993", direction: "expense" }),
    ]);
    expect(overview[0]).toMatchObject({
      expenseMinor: "9007199254740993",
      incomeMinor: "18446744073709551614",
      netMinor: "18437736874454810621",
    });
  });

  it("uses direction for negative net and rejects signed magnitudes", () => {
    expect(
      calculate([
        record({ amountMinor: "200" }),
        record({ amountMinor: "50", direction: "income" }),
      ])[0],
    ).toMatchObject({ expenseMinor: "200", incomeMinor: "50", netMinor: "-150" });
    expect(() => calculate([record({ amountMinor: "-1" })])).toThrow();
  });

  it("orders currencies and bucket rows identically for every input permutation", () => {
    const records = [
      record({ amountMinor: "1", categoryId: null, categoryName: null, currency: "USD" }),
      record({
        amountMinor: "2",
        categoryId: "10000000-0000-4000-8000-000000000003",
        categoryName: "Zed",
        currency: "EUR",
        planningStatus: null,
        purpose: "work",
      }),
      record({
        amountMinor: "3",
        categoryId: "10000000-0000-4000-8000-000000000002",
        categoryName: "Alpha",
        currency: "USD",
        planningStatus: "unplanned",
        purpose: null,
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
});
