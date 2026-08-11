export const GOLDEN_ACCOUNT = "00000000-0000-4000-8000-000000000041";
export const OTHER_ACCOUNT = "00000000-0000-4000-8000-000000000042";
export const GOLDEN_MONTH = "2026-03";
export const GOLDEN_TIMEZONE = "America/New_York";
export const GOLDEN_NOW = "2026-03-15T12:00:00Z";
export const GOLDEN_BOUNDS = {
  endExclusive: "2026-04-01T04:00:00Z",
  startInclusive: "2026-03-01T05:00:00Z",
} as const;

export interface GoldenExportRow {
  readonly amountMinor: string;
  readonly authority: "assisted_capture" | "draft" | "money_memo";
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly currency: "EUR" | "IDR" | "USD";
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

export const goldenCategories = [
  { id: "10000000-0000-4000-8000-000000000041", kind: "income", name: "Salary" },
  { id: "10000000-0000-4000-8000-000000000042", kind: "expense", name: "Food" },
  { id: "10000000-0000-4000-8000-000000000043", kind: "expense", name: "Travel" },
  { id: "10000000-0000-4000-8000-000000000044", kind: "income", name: "Consulting" },
  { id: "10000000-0000-4000-8000-000000000045", kind: "expense", name: "Software" },
] as const;

export const goldenSpaces = [
  { id: "20000000-0000-4000-8000-000000000041", name: "Personal" },
  { id: "20000000-0000-4000-8000-000000000042", name: "Work" },
] as const;

export const goldenExportRows: readonly GoldenExportRow[] = [
  {
    amountMinor: "10000",
    authority: "money_memo",
    categoryId: goldenCategories[0].id,
    categoryName: goldenCategories[0].name,
    currency: "USD",
    currencyExponent: 2,
    direction: "income",
    id: "30000000-0000-4000-8000-000000000041",
    lifecycle: "active",
    moneySpaceId: goldenSpaces[1].id,
    occurredAt: GOLDEN_BOUNDS.startInclusive,
    planningStatus: "planned",
    purpose: "work",
  },
  {
    amountMinor: "2500",
    authority: "money_memo",
    categoryId: goldenCategories[1].id,
    categoryName: goldenCategories[1].name,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000042",
    lifecycle: "archived",
    moneySpaceId: goldenSpaces[0].id,
    occurredAt: "2026-03-15T10:00:00Z",
    planningStatus: "planned",
    purpose: "personal",
  },
  {
    amountMinor: "1200",
    authority: "money_memo",
    categoryId: goldenCategories[2].id,
    categoryName: goldenCategories[2].name,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000043",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: "2026-03-15T10:00:00Z",
    planningStatus: "unplanned",
    purpose: "mixed",
  },
  {
    amountMinor: "9999",
    authority: "money_memo",
    categoryId: goldenCategories[1].id,
    categoryName: goldenCategories[1].name,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000044",
    lifecycle: "recently_deleted",
    moneySpaceId: goldenSpaces[0].id,
    occurredAt: "2026-03-20T10:00:00Z",
    planningStatus: "planned",
    purpose: "personal",
  },
  {
    amountMinor: "8888",
    authority: "money_memo",
    categoryId: goldenCategories[1].id,
    categoryName: goldenCategories[1].name,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000045",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: "2026-03-01T04:59:59.999Z",
    planningStatus: null,
    purpose: null,
  },
  {
    amountMinor: "7777",
    authority: "money_memo",
    categoryId: goldenCategories[0].id,
    categoryName: goldenCategories[0].name,
    currency: "USD",
    currencyExponent: 2,
    direction: "income",
    id: "30000000-0000-4000-8000-000000000046",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: GOLDEN_BOUNDS.endExclusive,
    planningStatus: null,
    purpose: null,
  },
  {
    amountMinor: "3000",
    authority: "money_memo",
    categoryId: goldenCategories[3].id,
    categoryName: goldenCategories[3].name,
    currency: "EUR",
    currencyExponent: 2,
    direction: "income",
    id: "30000000-0000-4000-8000-000000000047",
    lifecycle: "active",
    moneySpaceId: goldenSpaces[1].id,
    occurredAt: "2026-03-05T08:00:00Z",
    planningStatus: "planned",
    purpose: "work",
  },
  {
    amountMinor: "4500",
    authority: "money_memo",
    categoryId: goldenCategories[4].id,
    categoryName: goldenCategories[4].name,
    currency: "EUR",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000048",
    lifecycle: "archived",
    moneySpaceId: goldenSpaces[1].id,
    occurredAt: "2026-03-06T08:00:00Z",
    planningStatus: null,
    purpose: null,
  },
  {
    amountMinor: "1000000",
    authority: "money_memo",
    categoryId: goldenCategories[0].id,
    categoryName: goldenCategories[0].name,
    currency: "IDR",
    currencyExponent: 2,
    direction: "income",
    id: "30000000-0000-4000-8000-000000000049",
    lifecycle: "active",
    moneySpaceId: goldenSpaces[0].id,
    occurredAt: "2026-03-07T08:00:00Z",
    planningStatus: null,
    purpose: "personal",
  },
  {
    amountMinor: "250000",
    authority: "money_memo",
    categoryId: null,
    categoryName: null,
    currency: "IDR",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000050",
    lifecycle: "active",
    moneySpaceId: null,
    occurredAt: "2026-03-08T08:00:00Z",
    planningStatus: "unplanned",
    purpose: null,
  },
  {
    amountMinor: "111",
    authority: "money_memo",
    categoryId: goldenCategories[4].id,
    categoryName: goldenCategories[4].name,
    currency: "EUR",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000051",
    lifecycle: "purging",
    moneySpaceId: null,
    occurredAt: "2026-03-09T08:00:00Z",
    planningStatus: "planned",
    purpose: "work",
  },
  {
    amountMinor: "222",
    authority: "money_memo",
    categoryId: null,
    categoryName: null,
    currency: "EUR",
    currencyExponent: 2,
    direction: "expense",
    id: "30000000-0000-4000-8000-000000000052",
    lifecycle: "purged",
    moneySpaceId: null,
    occurredAt: "2026-03-10T08:00:00Z",
    planningStatus: null,
    purpose: null,
  },
  {
    amountMinor: "333",
    authority: "draft",
    categoryId: null,
    categoryName: null,
    currency: "USD",
    currencyExponent: 2,
    direction: "expense",
    id: "40000000-0000-4000-8000-000000000041",
    lifecycle: "unconfirmed",
    moneySpaceId: null,
    occurredAt: "2026-03-11T08:00:00Z",
    planningStatus: null,
    purpose: null,
  },
  {
    amountMinor: "444",
    authority: "assisted_capture",
    categoryId: null,
    categoryName: null,
    currency: "USD",
    currencyExponent: 2,
    direction: "income",
    id: "50000000-0000-4000-8000-000000000041",
    lifecycle: "unconfirmed",
    moneySpaceId: null,
    occurredAt: "2026-03-12T08:00:00Z",
    planningStatus: null,
    purpose: null,
  },
];

interface OracleBucket {
  amountMinor: string;
  key: string;
  label: string;
}

interface OracleCurrency {
  categoryBreakdown: readonly OracleBucket[];
  currency: string;
  currencyExponent: number;
  expenseMinor: string;
  incomeMinor: string;
  netMinor: string;
  planningBreakdown: readonly OracleBucket[];
  purposeBreakdown: readonly OracleBucket[];
}

const fixedLabels = {
  mixed: "Mixed",
  personal: "Personal",
  planned: "Planned",
  unspecified: "Unspecified",
  unplanned: "Unplanned",
  work: "Work",
} as const;

function add(
  target: Map<string, { amount: bigint; label: string }>,
  key: string,
  label: string,
  amount: bigint,
): void {
  const current = target.get(key);
  if (current === undefined) target.set(key, { amount, label });
  else current.amount += amount;
}

function buckets(
  values: Map<string, { amount: bigint; label: string }>,
  order?: readonly string[],
): readonly OracleBucket[] {
  const rank = new Map((order ?? []).map((key, index) => [key, index]));
  return [...values.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (order !== undefined) return (rank.get(leftKey) ?? 99) - (rank.get(rightKey) ?? 99);
      if (left.label !== right.label) return left.label < right.label ? -1 : 1;
      return leftKey < rightKey ? -1 : leftKey === rightKey ? 0 : 1;
    })
    .map(([key, value]) => ({ amountMinor: value.amount.toString(), key, label: value.label }));
}

export function independentlyRecomputeGolden(
  rows: readonly GoldenExportRow[] = goldenExportRows,
): readonly OracleCurrency[] {
  const partitions = new Map<
    string,
    {
      categories: Map<string, { amount: bigint; label: string }>;
      expense: bigint;
      exponent: number;
      income: bigint;
      planning: Map<string, { amount: bigint; label: string }>;
      purpose: Map<string, { amount: bigint; label: string }>;
    }
  >();
  for (const row of rows) {
    if (
      row.authority !== "money_memo" ||
      (row.lifecycle !== "active" && row.lifecycle !== "archived") ||
      row.occurredAt < GOLDEN_BOUNDS.startInclusive ||
      row.occurredAt >= GOLDEN_BOUNDS.endExclusive
    ) {
      continue;
    }
    const part = partitions.get(row.currency) ?? {
      categories: new Map<string, { amount: bigint; label: string }>(),
      expense: 0n,
      exponent: row.currencyExponent,
      income: 0n,
      planning: new Map<string, { amount: bigint; label: string }>(),
      purpose: new Map<string, { amount: bigint; label: string }>(),
    };
    const amount = BigInt(row.amountMinor);
    if (row.direction === "income") part.income += amount;
    else part.expense += amount;
    add(
      part.categories,
      row.categoryId ?? "uncategorized",
      row.categoryName ?? "Uncategorized",
      amount,
    );
    const planning = row.planningStatus ?? "unspecified";
    add(part.planning, planning, fixedLabels[planning], amount);
    const purpose = row.purpose ?? "unspecified";
    add(part.purpose, purpose, fixedLabels[purpose], amount);
    partitions.set(row.currency, part);
  }
  return [...partitions.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1))
    .map(([currency, part]) => ({
      categoryBreakdown: buckets(part.categories),
      currency,
      currencyExponent: part.exponent,
      expenseMinor: part.expense.toString(),
      incomeMinor: part.income.toString(),
      netMinor: (part.income - part.expense).toString(),
      planningBreakdown: buckets(part.planning, ["planned", "unplanned", "unspecified"]),
      purposeBreakdown: buckets(part.purpose, ["personal", "work", "mixed", "unspecified"]),
    }));
}

export const reviewedGoldenCurrencies: readonly OracleCurrency[] = [
  {
    categoryBreakdown: [
      { amountMinor: "3000", key: goldenCategories[3].id, label: "Consulting" },
      { amountMinor: "4500", key: goldenCategories[4].id, label: "Software" },
    ],
    currency: "EUR",
    currencyExponent: 2,
    expenseMinor: "4500",
    incomeMinor: "3000",
    netMinor: "-1500",
    planningBreakdown: [
      { amountMinor: "3000", key: "planned", label: "Planned" },
      { amountMinor: "4500", key: "unspecified", label: "Unspecified" },
    ],
    purposeBreakdown: [
      { amountMinor: "3000", key: "work", label: "Work" },
      { amountMinor: "4500", key: "unspecified", label: "Unspecified" },
    ],
  },
  {
    categoryBreakdown: [
      { amountMinor: "1000000", key: goldenCategories[0].id, label: "Salary" },
      { amountMinor: "250000", key: "uncategorized", label: "Uncategorized" },
    ],
    currency: "IDR",
    currencyExponent: 2,
    expenseMinor: "250000",
    incomeMinor: "1000000",
    netMinor: "750000",
    planningBreakdown: [
      { amountMinor: "250000", key: "unplanned", label: "Unplanned" },
      { amountMinor: "1000000", key: "unspecified", label: "Unspecified" },
    ],
    purposeBreakdown: [
      { amountMinor: "1000000", key: "personal", label: "Personal" },
      { amountMinor: "250000", key: "unspecified", label: "Unspecified" },
    ],
  },
  {
    categoryBreakdown: [
      { amountMinor: "2500", key: goldenCategories[1].id, label: "Food" },
      { amountMinor: "10000", key: goldenCategories[0].id, label: "Salary" },
      { amountMinor: "1200", key: goldenCategories[2].id, label: "Travel" },
    ],
    currency: "USD",
    currencyExponent: 2,
    expenseMinor: "3700",
    incomeMinor: "10000",
    netMinor: "6300",
    planningBreakdown: [
      { amountMinor: "12500", key: "planned", label: "Planned" },
      { amountMinor: "1200", key: "unplanned", label: "Unplanned" },
    ],
    purposeBreakdown: [
      { amountMinor: "2500", key: "personal", label: "Personal" },
      { amountMinor: "10000", key: "work", label: "Work" },
      { amountMinor: "1200", key: "mixed", label: "Mixed" },
    ],
  },
];
