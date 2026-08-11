import { Temporal } from "@js-temporal/polyfill";

import {
  calculateCurrentMonth,
  type CurrentMonthBucket,
  type CurrentMonthCandidate,
  type CurrentMonthCurrencyOverview,
} from "./current-month.js";
import type { ReportingMonthBounds } from "../time/reporting-period.js";

interface MonthlyReviewCandidate extends CurrentMonthCandidate {
  readonly categoryNormalizedName: string | null;
}

interface MonthlyReviewInput {
  readonly priorBounds: ReportingMonthBounds;
  readonly records: readonly MonthlyReviewCandidate[];
  readonly selectedBounds: ReportingMonthBounds;
}

interface MonthlyCurrencyReview {
  readonly currency: string;
  readonly currencyExponent: number;
  readonly expenseMinor: string;
  readonly incomeMinor: string;
  readonly largestExpenseCategories: readonly CurrentMonthBucket[];
  readonly netMinor: string;
  readonly priorMonth: {
    readonly absoluteChangeMinor: string;
    readonly expenseMinor: string;
    readonly percentageChange: string | null;
    readonly percentageUnavailableReason: "PRIOR_VALUE_ZERO" | null;
  };
  readonly unplannedExpenseMinor: string;
}

class MonthlyReviewCalculationError extends Error {
  constructor() {
    super("Monthly review calculation failed.");
    this.name = "MonthlyReviewCalculationError";
  }
}

interface RankedCategory {
  amount: bigint;
  readonly label: string;
  readonly normalizedName: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left === right ? 0 : 1;
}

function parseInstant(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new MonthlyReviewCalculationError();
  }
}

function eligibleWithin(
  record: MonthlyReviewCandidate,
  start: Temporal.Instant,
  end: Temporal.Instant,
): boolean {
  if (
    record.authority !== "money_memo" ||
    (record.lifecycle !== "active" && record.lifecycle !== "archived")
  ) {
    return false;
  }
  const occurredAt = parseInstant(record.occurredAt);
  return (
    Temporal.Instant.compare(occurredAt, start) >= 0 &&
    Temporal.Instant.compare(occurredAt, end) < 0
  );
}

function exactPercentageChange(delta: bigint, prior: bigint): string {
  if (prior <= 0n) throw new MonthlyReviewCalculationError();
  const negative = delta < 0n;
  const magnitude = negative ? -delta : delta;
  const scaled = magnitude * 10_000n;
  let hundredths = scaled / prior;
  if ((scaled % prior) * 2n >= prior) hundredths += 1n;
  const digits = hundredths.toString().padStart(3, "0");
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2).replace(/0+$/u, "");
  const rendered = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  return negative && hundredths !== 0n ? `-${rendered}` : rendered;
}

function rankedExpenseCategories(
  records: readonly MonthlyReviewCandidate[],
): readonly CurrentMonthBucket[] {
  const categories = new Map<string, RankedCategory>();
  for (const record of records) {
    if (record.direction !== "expense") continue;
    if (
      (record.categoryId === null) !== (record.categoryName === null) ||
      (record.categoryId === null) !== (record.categoryNormalizedName === null)
    ) {
      throw new MonthlyReviewCalculationError();
    }
    const amount = BigInt(record.amountMinor);
    if (amount <= 0n) throw new MonthlyReviewCalculationError();
    const key = record.categoryId ?? "uncategorized";
    const label = record.categoryName ?? "Uncategorized";
    const normalizedName = record.categoryNormalizedName ?? "uncategorized";
    const current = categories.get(key);
    if (current === undefined) {
      categories.set(key, { amount, label, normalizedName });
    } else {
      if (current.label !== label || current.normalizedName !== normalizedName) {
        throw new MonthlyReviewCalculationError();
      }
      current.amount += amount;
    }
  }
  return [...categories.entries()]
    .sort(([leftId, left], [rightId, right]) => {
      if (left.amount !== right.amount) return left.amount > right.amount ? -1 : 1;
      const nameOrder = compareText(left.normalizedName, right.normalizedName);
      return nameOrder === 0 ? compareText(leftId, rightId) : nameOrder;
    })
    .map(([key, category]) =>
      Object.freeze({ amountMinor: category.amount.toString(), key, label: category.label }),
    );
}

function sectionMap(
  sections: readonly CurrentMonthCurrencyOverview[],
): ReadonlyMap<string, CurrentMonthCurrencyOverview> {
  return new Map(sections.map((section) => [section.currency, section]));
}

function calculateMonthlyReview(
  input: Readonly<MonthlyReviewInput>,
): readonly MonthlyCurrencyReview[] {
  const priorStart = parseInstant(input.priorBounds.startInclusive);
  const priorEnd = parseInstant(input.priorBounds.endExclusive);
  const selectedStart = parseInstant(input.selectedBounds.startInclusive);
  const selectedEnd = parseInstant(input.selectedBounds.endExclusive);
  if (
    Temporal.Instant.compare(priorStart, priorEnd) >= 0 ||
    Temporal.Instant.compare(selectedStart, selectedEnd) >= 0 ||
    Temporal.Instant.compare(priorEnd, selectedStart) !== 0
  ) {
    throw new MonthlyReviewCalculationError();
  }

  const selectedTotals = sectionMap(
    calculateCurrentMonth({ bounds: input.selectedBounds, records: input.records }),
  );
  const priorTotals = sectionMap(
    calculateCurrentMonth({ bounds: input.priorBounds, records: input.records }),
  );
  const selectedEligible = input.records.filter((record) =>
    eligibleWithin(record, selectedStart, selectedEnd),
  );
  const currencies = [...new Set([...selectedTotals.keys(), ...priorTotals.keys()])].sort(
    compareText,
  );

  return currencies.map((currency) => {
    const selected = selectedTotals.get(currency);
    const prior = priorTotals.get(currency);
    if (
      selected !== undefined &&
      prior !== undefined &&
      selected.currencyExponent !== prior.currencyExponent
    ) {
      throw new MonthlyReviewCalculationError();
    }
    const exponent = selected?.currencyExponent ?? prior?.currencyExponent;
    if (exponent === undefined) throw new MonthlyReviewCalculationError();
    const income = BigInt(selected?.incomeMinor ?? "0");
    const expense = BigInt(selected?.expenseMinor ?? "0");
    const priorExpense = BigInt(prior?.expenseMinor ?? "0");
    const delta = expense - priorExpense;
    const selectedCurrencyRows = selectedEligible.filter((record) => record.currency === currency);
    const unplannedExpense = selectedCurrencyRows
      .filter((record) => record.direction === "expense" && record.planningStatus === "unplanned")
      .reduce((sum, record) => sum + BigInt(record.amountMinor), 0n);
    return Object.freeze({
      currency,
      currencyExponent: exponent,
      expenseMinor: expense.toString(),
      incomeMinor: income.toString(),
      largestExpenseCategories: rankedExpenseCategories(selectedCurrencyRows),
      netMinor: (income - expense).toString(),
      priorMonth: Object.freeze({
        absoluteChangeMinor: delta.toString(),
        expenseMinor: priorExpense.toString(),
        percentageChange: priorExpense === 0n ? null : exactPercentageChange(delta, priorExpense),
        percentageUnavailableReason: priorExpense === 0n ? "PRIOR_VALUE_ZERO" : null,
      }),
      unplannedExpenseMinor: unplannedExpense.toString(),
    });
  });
}

export {
  MonthlyReviewCalculationError,
  calculateMonthlyReview,
  exactPercentageChange,
  type MonthlyCurrencyReview,
  type MonthlyReviewCandidate,
  type MonthlyReviewInput,
};
