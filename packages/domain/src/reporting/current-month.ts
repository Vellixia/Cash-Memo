import { Temporal } from "@js-temporal/polyfill";

import type { ReportingMonthBounds } from "../time/reporting-period.js";

type MoneyDirection = "expense" | "income";
type ReportingAuthority = "assisted_capture" | "draft" | "money_memo";
type ReportingLifecycle =
  "active" | "archived" | "purged" | "purging" | "recently_deleted" | "unconfirmed";
type PlanningStatus = "planned" | "unplanned";
type MemoPurpose = "mixed" | "personal" | "work";

interface CurrentMonthCandidate {
  readonly amountMinor: string;
  readonly authority: ReportingAuthority;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly direction: MoneyDirection;
  readonly lifecycle: ReportingLifecycle;
  readonly moneySpaceId: string | null;
  readonly occurredAt: string;
  readonly planningStatus: PlanningStatus | null;
  readonly purpose: MemoPurpose | null;
}

interface CurrentMonthInput {
  readonly bounds: ReportingMonthBounds;
  readonly records: readonly CurrentMonthCandidate[];
}

interface CurrentMonthBucket {
  readonly amountMinor: string;
  readonly key: string;
  readonly label: string;
}

interface CurrentMonthCurrencyOverview {
  readonly categoryBreakdown: readonly CurrentMonthBucket[];
  readonly currency: string;
  readonly currencyExponent: number;
  readonly expenseMinor: string;
  readonly incomeMinor: string;
  readonly netMinor: string;
  readonly planningBreakdown: readonly CurrentMonthBucket[];
  readonly purposeBreakdown: readonly CurrentMonthBucket[];
}

class CurrentMonthCalculationError extends Error {
  constructor() {
    super("Current-month calculation failed.");
    this.name = "CurrentMonthCalculationError";
  }
}

interface MutableBucket {
  amount: bigint;
  readonly label: string;
}

interface MutablePartition {
  readonly categories: Map<string, MutableBucket>;
  expense: bigint;
  readonly exponent: number;
  income: bigint;
  readonly planning: Map<string, MutableBucket>;
  readonly purpose: Map<string, MutableBucket>;
}

const PLANNING_LABELS = {
  planned: "Planned",
  unspecified: "Unspecified",
  unplanned: "Unplanned",
} as const;

const PURPOSE_LABELS = {
  mixed: "Mixed",
  personal: "Personal",
  unspecified: "Unspecified",
  work: "Work",
} as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left === right ? 0 : 1;
}

function parsePositiveMinor(value: string): bigint {
  if (!/^[1-9]\d*$/u.test(value)) throw new CurrentMonthCalculationError();
  try {
    return BigInt(value);
  } catch {
    throw new CurrentMonthCalculationError();
  }
}

function parseInstant(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new CurrentMonthCalculationError();
  }
}

function addBucket(
  buckets: Map<string, MutableBucket>,
  key: string,
  label: string,
  amount: bigint,
): void {
  const existing = buckets.get(key);
  if (existing === undefined) {
    buckets.set(key, { amount, label });
    return;
  }
  if (existing.label !== label) throw new CurrentMonthCalculationError();
  existing.amount += amount;
}

function orderedBuckets(
  buckets: ReadonlyMap<string, MutableBucket>,
  fixedOrder?: readonly string[],
): readonly CurrentMonthBucket[] {
  const rank = new Map((fixedOrder ?? []).map((key, index) => [key, index]));
  return [...buckets.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (fixedOrder !== undefined) {
        const rankDifference = (rank.get(leftKey) ?? 99) - (rank.get(rightKey) ?? 99);
        if (rankDifference !== 0) return rankDifference;
      }
      const labelDifference = compareText(left.label, right.label);
      return labelDifference === 0 ? compareText(leftKey, rightKey) : labelDifference;
    })
    .map(([key, value]) =>
      Object.freeze({ amountMinor: value.amount.toString(), key, label: value.label }),
    );
}

function calculateCurrentMonth(
  input: Readonly<CurrentMonthInput>,
): readonly CurrentMonthCurrencyOverview[] {
  const start = parseInstant(input.bounds.startInclusive);
  const end = parseInstant(input.bounds.endExclusive);
  if (Temporal.Instant.compare(start, end) >= 0) throw new CurrentMonthCalculationError();

  const partitions = new Map<string, MutablePartition>();
  for (const record of input.records) {
    if (
      record.authority !== "money_memo" ||
      (record.lifecycle !== "active" && record.lifecycle !== "archived")
    ) {
      continue;
    }
    const occurredAt = parseInstant(record.occurredAt);
    if (
      Temporal.Instant.compare(occurredAt, start) < 0 ||
      Temporal.Instant.compare(occurredAt, end) >= 0
    ) {
      continue;
    }
    if (!/^[A-Z]{3}$/u.test(record.currency)) throw new CurrentMonthCalculationError();
    if (
      !Number.isInteger(record.currencyExponent) ||
      record.currencyExponent < 0 ||
      record.currencyExponent > 3
    ) {
      throw new CurrentMonthCalculationError();
    }
    if ((record.categoryId === null) !== (record.categoryName === null)) {
      throw new CurrentMonthCalculationError();
    }
    const amount = parsePositiveMinor(record.amountMinor);
    const existing = partitions.get(record.currency);
    if (existing !== undefined && existing.exponent !== record.currencyExponent) {
      throw new CurrentMonthCalculationError();
    }
    const partition = existing ?? {
      categories: new Map<string, MutableBucket>(),
      expense: 0n,
      exponent: record.currencyExponent,
      income: 0n,
      planning: new Map<string, MutableBucket>(),
      purpose: new Map<string, MutableBucket>(),
    };
    if (record.direction === "income") partition.income += amount;
    else partition.expense += amount;

    addBucket(
      partition.categories,
      record.categoryId ?? "uncategorized",
      record.categoryName ?? "Uncategorized",
      amount,
    );
    const planning = record.planningStatus ?? "unspecified";
    addBucket(partition.planning, planning, PLANNING_LABELS[planning], amount);
    const purpose = record.purpose ?? "unspecified";
    addBucket(partition.purpose, purpose, PURPOSE_LABELS[purpose], amount);
    partitions.set(record.currency, partition);
  }

  return [...partitions.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([currency, partition]) =>
      Object.freeze({
        categoryBreakdown: orderedBuckets(partition.categories),
        currency,
        currencyExponent: partition.exponent,
        expenseMinor: partition.expense.toString(),
        incomeMinor: partition.income.toString(),
        netMinor: (partition.income - partition.expense).toString(),
        planningBreakdown: orderedBuckets(partition.planning, [
          "planned",
          "unplanned",
          "unspecified",
        ]),
        purposeBreakdown: orderedBuckets(partition.purpose, [
          "personal",
          "work",
          "mixed",
          "unspecified",
        ]),
      }),
    );
}

export {
  CurrentMonthCalculationError,
  calculateCurrentMonth,
  type CurrentMonthBucket,
  type CurrentMonthCandidate,
  type CurrentMonthCurrencyOverview,
  type CurrentMonthInput,
};
