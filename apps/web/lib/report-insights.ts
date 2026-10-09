import type { ReportPeriod, Trend } from "@/lib/api";

export type ReportRange = "month" | "3" | "6" | "12";
export type Totals = { income: number; expense: number; net: number };
export type CategoryAmount = { key: string; amount: number };
export type CategoryChange = { key: string; before: number; now: number; delta: number; percent: number | null };

const UNCATEGORIZED = "uncategorized";

export function monthsForRange(trend: Trend, range: ReportRange): string[] {
  return trend.months.slice(-(range === "month" ? 1 : Number(range)));
}

export function totalsFor(trend: Trend, currency: string, months: readonly string[]): Totals {
  const selected = new Set(months);
  let income = 0;
  let expense = 0;
  for (const row of trend.totals) {
    if (!selected.has(row.month) || row.currency !== currency) continue;
    if (row.direction === "income") income += row.total_minor;
    if (row.direction === "expense") expense += row.total_minor;
  }
  return { income, expense, net: income - expense };
}

/** Income/expense/net for one comparison period in one currency (transfers never arrive here). */
export function periodTotals(period: ReportPeriod, currency: string): Totals {
  let income = 0;
  let expense = 0;
  for (const row of period.totals) {
    if (row.currency !== currency) continue;
    if (row.direction === "income") income += row.total_minor;
    if (row.direction === "expense") expense += row.total_minor;
  }
  return { income, expense, net: income - expense };
}

function categoryAmounts(trend: Trend, currency: string, months: readonly string[]): Map<string, number> {
  const selected = new Set(months);
  const totals = new Map<string, number>();
  for (const row of trend.by_category) {
    if (row.currency !== currency || !selected.has(row.month)) continue;
    const key = row.category_id ?? UNCATEGORIZED;
    totals.set(key, (totals.get(key) ?? 0) + row.total_minor);
  }
  return totals;
}

/** null means percentage undefined: previous amount was zero. Never show Infinity%. */
export function changePercent(before: number, now: number): number | null {
  return before <= 0 ? null : Math.round(((now - before) / before) * 100);
}

export function categoryChanges(previous: ReportPeriod, current: ReportPeriod, currency: string): CategoryChange[] {
  const amounts = (period: ReportPeriod) => {
    const totals = new Map<string, number>();
    for (const row of period.by_category) {
      if (row.currency !== currency) continue;
      const key = row.category_id ?? UNCATEGORIZED;
      totals.set(key, (totals.get(key) ?? 0) + row.total_minor);
    }
    return totals;
  };
  const before = amounts(previous);
  const now = amounts(current);
  return [...new Set([...before.keys(), ...now.keys()])]
    .map((key) => {
      const b = before.get(key) ?? 0;
      const n = now.get(key) ?? 0;
      return { key, before: b, now: n, delta: n - b, percent: changePercent(b, n) };
    })
    .filter((row) => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function topSpending(trend: Trend, currency: string, months: readonly string[]): (CategoryAmount & { share: number })[] {
  const amounts = categoryAmounts(trend, currency, months);
  const total = [...amounts.values()].reduce((sum, n) => sum + n, 0);
  return [...amounts.entries()]
    .map(([key, amount]) => ({ key, amount, share: total > 0 ? Math.round((amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
}
