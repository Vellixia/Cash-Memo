export const REVIEW_GOLDEN_ACCOUNT = "00000000-0000-4000-8000-000000000091";
export const REVIEW_OTHER_ACCOUNT = "00000000-0000-4000-8000-000000000092";
export const REVIEW_SELECTED_MONTH = "2026-03";
export const REVIEW_PRIOR_MONTH = "2026-02";
export const REVIEW_TIMEZONE = "America/New_York";
export const REVIEW_NOW = "2026-03-20T12:00:00Z";
export const REVIEW_SELECTED_BOUNDS = {
  endExclusive: "2026-04-01T04:00:00Z",
  startInclusive: "2026-03-01T05:00:00Z",
} as const;
export const REVIEW_PRIOR_BOUNDS = {
  endExclusive: REVIEW_SELECTED_BOUNDS.startInclusive,
  startInclusive: "2026-02-01T05:00:00Z",
} as const;

export interface MonthlyReviewExportRow {
  readonly amountMinor: string;
  readonly authority: "assisted_capture" | "draft" | "money_memo";
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly categoryNormalizedName: string | null;
  readonly currency: "EUR" | "IDR" | "JPY" | "USD";
  readonly currencyExponent: number;
  readonly direction: "expense" | "income";
  readonly id: string;
  readonly lifecycle:
    "active" | "archived" | "purged" | "purging" | "recently_deleted" | "unconfirmed";
  readonly moneySpaceId: string | null;
  readonly occurredAt: string;
  readonly planningStatus: "planned" | "unplanned" | null;
  readonly purpose: "mixed" | "personal" | "work" | null;
}

export const reviewGoldenCategories = [
  {
    id: "11000000-0000-4000-8000-000000000091",
    kind: "expense",
    name: "Alpha first",
    normalizedName: "alpha",
    status: "active",
  },
  {
    id: "11000000-0000-4000-8000-000000000092",
    kind: "expense",
    name: "Alpha second",
    normalizedName: "alpha",
    status: "inactive",
  },
  {
    id: "11000000-0000-4000-8000-000000000093",
    kind: "expense",
    name: "Beta",
    normalizedName: "beta",
    status: "active",
  },
  {
    id: "11000000-0000-4000-8000-000000000094",
    kind: "income",
    name: "Salary",
    normalizedName: "salary",
    status: "active",
  },
  {
    id: "11000000-0000-4000-8000-000000000095",
    kind: "income",
    name: "Consulting",
    normalizedName: "consulting",
    status: "active",
  },
] as const;

export const reviewGoldenSpaces = [
  { id: "21000000-0000-4000-8000-000000000091", name: "Personal" },
  { id: "21000000-0000-4000-8000-000000000092", name: "Work" },
] as const;

export const monthlyReviewExportRows: readonly MonthlyReviewExportRow[] = [
  {
    amountMinor: "5000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[3].id,
    categoryName: reviewGoldenCategories[3].name,
    categoryNormalizedName: reviewGoldenCategories[3].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "income",
    id: "31000000-0000-4000-8000-000000000091",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[1].id,
    occurredAt: "2026-02-10T10:00:00Z",
    planningStatus: "planned",
    purpose: "work",
  },
  {
    amountMinor: "4000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[0].id,
    categoryName: reviewGoldenCategories[0].name,
    categoryNormalizedName: reviewGoldenCategories[0].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000092",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[0].id,
    occurredAt: "2026-02-11T10:00:00Z",
    planningStatus: "planned",
    purpose: "personal",
  },
  {
    amountMinor: "1000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[2].id,
    categoryName: reviewGoldenCategories[2].name,
    categoryNormalizedName: reviewGoldenCategories[2].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000093",
    lifecycle: "archived",
    moneySpaceId: reviewGoldenSpaces[0].id,
    occurredAt: "2026-02-12T10:00:00Z",
    planningStatus: "unplanned",
    purpose: "personal",
  },
  {
    amountMinor: "10000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[3].id,
    categoryName: reviewGoldenCategories[3].name,
    categoryNormalizedName: reviewGoldenCategories[3].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "income",
    id: "31000000-0000-4000-8000-000000000094",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[1].id,
    occurredAt: REVIEW_SELECTED_BOUNDS.startInclusive,
    planningStatus: "planned",
    purpose: "work",
  },
  {
    amountMinor: "3000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[0].id,
    categoryName: reviewGoldenCategories[0].name,
    categoryNormalizedName: reviewGoldenCategories[0].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000095",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[0].id,
    occurredAt: "2026-03-10T10:00:00Z",
    planningStatus: "unplanned",
    purpose: "personal",
  },
  {
    amountMinor: "3000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[1].id,
    categoryName: reviewGoldenCategories[1].name,
    categoryNormalizedName: reviewGoldenCategories[1].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000096",
    lifecycle: "archived",
    moneySpaceId: reviewGoldenSpaces[0].id,
    occurredAt: "2026-03-11T10:00:00Z",
    planningStatus: "planned",
    purpose: "personal",
  },
  {
    amountMinor: "1000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[2].id,
    categoryName: reviewGoldenCategories[2].name,
    categoryNormalizedName: reviewGoldenCategories[2].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000097",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: "2026-03-12T10:00:00Z",
    planningStatus: "unplanned",
    purpose: "mixed",
  },
  {
    amountMinor: "2000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[4].id,
    categoryName: reviewGoldenCategories[4].name,
    categoryNormalizedName: reviewGoldenCategories[4].normalizedName,
    currency: "EUR",
    currencyExponent: 2,
    direction: "income",
    id: "31000000-0000-4000-8000-000000000098",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[1].id,
    occurredAt: "2026-02-15T10:00:00Z",
    planningStatus: null,
    purpose: "work",
  },
  {
    amountMinor: "1000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[4].id,
    categoryName: reviewGoldenCategories[4].name,
    categoryNormalizedName: reviewGoldenCategories[4].normalizedName,
    currency: "EUR",
    currencyExponent: 2,
    direction: "income",
    id: "31000000-0000-4000-8000-000000000099",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[1].id,
    occurredAt: "2026-03-14T10:00:00Z",
    planningStatus: null,
    purpose: "work",
  },
  {
    amountMinor: "2500",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[2].id,
    categoryName: reviewGoldenCategories[2].name,
    categoryNormalizedName: reviewGoldenCategories[2].normalizedName,
    currency: "EUR",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000100",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[1].id,
    occurredAt: "2026-03-15T10:00:00Z",
    planningStatus: "unplanned",
    purpose: "work",
  },
  {
    amountMinor: "100000",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[3].id,
    categoryName: reviewGoldenCategories[3].name,
    categoryNormalizedName: reviewGoldenCategories[3].normalizedName,
    currency: "IDR",
    currencyExponent: 2,
    direction: "income",
    id: "31000000-0000-4000-8000-000000000101",
    lifecycle: "active",
    moneySpaceId: reviewGoldenSpaces[0].id,
    occurredAt: "2026-03-16T10:00:00Z",
    planningStatus: "planned",
    purpose: "personal",
  },
  {
    amountMinor: "700",
    authority: "money_memo",
    categoryId: null,
    categoryName: null,
    categoryNormalizedName: null,
    currency: "JPY",
    currencyExponent: 0,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000102",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: REVIEW_PRIOR_BOUNDS.startInclusive,
    planningStatus: "unplanned",
    purpose: null,
  },
  {
    amountMinor: "9999",
    authority: "money_memo",
    categoryId: reviewGoldenCategories[2].id,
    categoryName: reviewGoldenCategories[2].name,
    categoryNormalizedName: reviewGoldenCategories[2].normalizedName,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000103",
    lifecycle: "recently_deleted",
    moneySpaceId: null,
    occurredAt: "2026-03-17T10:00:00Z",
    planningStatus: "unplanned",
    purpose: null,
  },
  {
    amountMinor: "8888",
    authority: "money_memo",
    categoryId: null,
    categoryName: null,
    categoryNormalizedName: null,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000104",
    lifecycle: "purging",
    moneySpaceId: null,
    occurredAt: "2026-03-18T10:00:00Z",
    planningStatus: "unplanned",
    purpose: null,
  },
  {
    amountMinor: "7777",
    authority: "money_memo",
    categoryId: null,
    categoryName: null,
    categoryNormalizedName: null,
    currency: "USD",
    currencyExponent: 2,
    direction: "income",
    id: "31000000-0000-4000-8000-000000000105",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: REVIEW_SELECTED_BOUNDS.endExclusive,
    planningStatus: null,
    purpose: null,
  },
  {
    amountMinor: "6666",
    authority: "money_memo",
    categoryId: null,
    categoryName: null,
    categoryNormalizedName: null,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "31000000-0000-4000-8000-000000000106",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: "2026-02-01T04:59:59.999Z",
    planningStatus: "unplanned",
    purpose: null,
  },
  {
    amountMinor: "5555",
    authority: "draft",
    categoryId: null,
    categoryName: null,
    categoryNormalizedName: null,
    currency: "USD",
    currencyExponent: 2,
    direction: "income",
    id: "41000000-0000-4000-8000-000000000091",
    lifecycle: "unconfirmed",
    moneySpaceId: null,
    occurredAt: "2026-03-19T10:00:00Z",
    planningStatus: null,
    purpose: null,
  },
  {
    amountMinor: "4444",
    authority: "assisted_capture",
    categoryId: null,
    categoryName: null,
    categoryNormalizedName: null,
    currency: "EUR",
    currencyExponent: 2,
    direction: "expense",
    id: "51000000-0000-4000-8000-000000000091",
    lifecycle: "unconfirmed",
    moneySpaceId: null,
    occurredAt: "2026-03-20T10:00:00Z",
    planningStatus: "unplanned",
    purpose: null,
  },
];

export interface ReviewOracleBucket {
  readonly amountMinor: string;
  readonly key: string;
  readonly label: string;
}

export interface ReviewOracleCurrency {
  readonly currency: string;
  readonly currencyExponent: number;
  readonly expenseMinor: string;
  readonly incomeMinor: string;
  readonly largestExpenseCategories: readonly ReviewOracleBucket[];
  readonly netMinor: string;
  readonly priorMonth: {
    readonly absoluteChangeMinor: string;
    readonly expenseMinor: string;
    readonly percentageChange: string | null;
    readonly percentageUnavailableReason: "PRIOR_VALUE_ZERO" | null;
  };
  readonly unplannedExpenseMinor: string;
}

function percentage(delta: bigint, prior: bigint): string {
  const negative = delta < 0n;
  const magnitude = negative ? -delta : delta;
  const scaled = magnitude * 10_000n;
  let hundredths = scaled / prior;
  if ((scaled % prior) * 2n >= prior) hundredths += 1n;
  const digits = hundredths.toString().padStart(3, "0");
  const fraction = digits.slice(-2).replace(/0+$/u, "");
  const rendered =
    fraction.length === 0 ? digits.slice(0, -2) : `${digits.slice(0, -2)}.${fraction}`;
  return negative && hundredths !== 0n ? `-${rendered}` : rendered;
}

export function independentlyRecomputeMonthlyReview(
  rows: readonly MonthlyReviewExportRow[] = monthlyReviewExportRows,
): readonly ReviewOracleCurrency[] {
  const eligible = rows.filter(
    (row) =>
      row.authority === "money_memo" &&
      (row.lifecycle === "active" || row.lifecycle === "archived"),
  );
  const currencies = [
    ...new Set(
      eligible
        .filter(
          (row) =>
            (row.occurredAt >= REVIEW_PRIOR_BOUNDS.startInclusive &&
              row.occurredAt < REVIEW_PRIOR_BOUNDS.endExclusive) ||
            (row.occurredAt >= REVIEW_SELECTED_BOUNDS.startInclusive &&
              row.occurredAt < REVIEW_SELECTED_BOUNDS.endExclusive),
        )
        .map((row) => row.currency),
    ),
  ].sort();

  return currencies.map((currency) => {
    const selected = eligible.filter(
      (row) =>
        row.currency === currency &&
        row.occurredAt >= REVIEW_SELECTED_BOUNDS.startInclusive &&
        row.occurredAt < REVIEW_SELECTED_BOUNDS.endExclusive,
    );
    const prior = eligible.filter(
      (row) =>
        row.currency === currency &&
        row.occurredAt >= REVIEW_PRIOR_BOUNDS.startInclusive &&
        row.occurredAt < REVIEW_PRIOR_BOUNDS.endExclusive,
    );
    const income = selected
      .filter((row) => row.direction === "income")
      .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
    const expense = selected
      .filter((row) => row.direction === "expense")
      .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
    const priorExpense = prior
      .filter((row) => row.direction === "expense")
      .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
    const categories = new Map<string, { amount: bigint; label: string; normalizedName: string }>();
    for (const row of selected.filter((item) => item.direction === "expense")) {
      const key = row.categoryId ?? "uncategorized";
      const current = categories.get(key);
      if (current === undefined) {
        categories.set(key, {
          amount: BigInt(row.amountMinor),
          label: row.categoryName ?? "Uncategorized",
          normalizedName: row.categoryNormalizedName ?? "uncategorized",
        });
      } else {
        current.amount += BigInt(row.amountMinor);
      }
    }
    const delta = expense - priorExpense;
    const exponent = (selected[0] ?? prior[0])?.currencyExponent;
    if (exponent === undefined) throw new Error("Golden currency exponent missing");
    return {
      currency,
      currencyExponent: exponent,
      expenseMinor: expense.toString(),
      incomeMinor: income.toString(),
      largestExpenseCategories: [...categories.entries()]
        .sort(([leftId, left], [rightId, right]) => {
          if (left.amount !== right.amount) return left.amount > right.amount ? -1 : 1;
          if (left.normalizedName !== right.normalizedName) {
            return left.normalizedName < right.normalizedName ? -1 : 1;
          }
          return leftId < rightId ? -1 : leftId === rightId ? 0 : 1;
        })
        .map(([key, value]) => ({
          amountMinor: value.amount.toString(),
          key,
          label: value.label,
        })),
      netMinor: (income - expense).toString(),
      priorMonth: {
        absoluteChangeMinor: delta.toString(),
        expenseMinor: priorExpense.toString(),
        percentageChange: priorExpense === 0n ? null : percentage(delta, priorExpense),
        percentageUnavailableReason: priorExpense === 0n ? "PRIOR_VALUE_ZERO" : null,
      },
      unplannedExpenseMinor: selected
        .filter((row) => row.direction === "expense" && row.planningStatus === "unplanned")
        .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n)
        .toString(),
    };
  });
}

export const reviewedMonthlyReviewCurrencies: readonly ReviewOracleCurrency[] = [
  {
    currency: "EUR",
    currencyExponent: 2,
    expenseMinor: "2500",
    incomeMinor: "1000",
    largestExpenseCategories: [
      { amountMinor: "2500", key: reviewGoldenCategories[2].id, label: "Beta" },
    ],
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
    currency: "IDR",
    currencyExponent: 2,
    expenseMinor: "0",
    incomeMinor: "100000",
    largestExpenseCategories: [],
    netMinor: "100000",
    priorMonth: {
      absoluteChangeMinor: "0",
      expenseMinor: "0",
      percentageChange: null,
      percentageUnavailableReason: "PRIOR_VALUE_ZERO",
    },
    unplannedExpenseMinor: "0",
  },
  {
    currency: "JPY",
    currencyExponent: 0,
    expenseMinor: "0",
    incomeMinor: "0",
    largestExpenseCategories: [],
    netMinor: "0",
    priorMonth: {
      absoluteChangeMinor: "-700",
      expenseMinor: "700",
      percentageChange: "-100",
      percentageUnavailableReason: null,
    },
    unplannedExpenseMinor: "0",
  },
  {
    currency: "USD",
    currencyExponent: 2,
    expenseMinor: "7000",
    incomeMinor: "10000",
    largestExpenseCategories: [
      { amountMinor: "3000", key: reviewGoldenCategories[0].id, label: "Alpha first" },
      { amountMinor: "3000", key: reviewGoldenCategories[1].id, label: "Alpha second" },
      { amountMinor: "1000", key: reviewGoldenCategories[2].id, label: "Beta" },
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
];
