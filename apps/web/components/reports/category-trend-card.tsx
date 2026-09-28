"use client";

import { monthLabel } from "@/components/reports/trend-card";
import { card } from "@/components/summary";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category, Trend } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const TOP = 5;

/** Small multiples: one bar row per top category, each bar sized against the same shared max
 * so rows stay comparable to each other (mirrors the donut's own top-N cutoff on Home). */
export function CategoryTrendCard({ trend, currency, categories }: { trend: Trend | undefined; currency: string; categories: Category[] }) {
  if (!trend) return <Skeleton className="h-64 rounded-3xl" />;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = trend.by_category.filter((r) => r.currency === currency);

  const totalByKey = new Map<string, number>();
  for (const r of rows) {
    const key = r.category_id ?? "none";
    totalByKey.set(key, (totalByKey.get(key) ?? 0) + r.total_minor);
  }
  const top = [...totalByKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);

  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="category-trend-title">
      <h2 id="category-trend-title" className="font-serif text-lg sm:text-xl">
        Spending trend by category
      </h2>
      {top.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No expenses in {currency} in this range yet.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {top.map(([key, total]) => {
            const c = key !== "none" ? byId.get(key) : undefined;
            const name = c?.name ?? "Uncategorized";
            const perMonth = (month: string) => rows.find((r) => (r.category_id ?? "none") === key && r.month === month)?.total_minor ?? 0;
            const rowMax = Math.max(1, ...trend.months.map(perMonth));
            return (
              <li key={key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
                    {c?.emoji && <span aria-hidden>{c.emoji}</span>}
                    {name}
                  </span>
                  <span className="num shrink-0 text-muted-foreground">{formatMoney(total, currency)}</span>
                </div>
                <div className="mt-1.5 flex h-8 items-end gap-0.5 sm:gap-1" role="img" aria-label={`${name} spending per month`}>
                  {trend.months.map((m) => (
                    <div
                      key={m}
                      className="flex-1 rounded-t-sm bg-expense/70"
                      style={{ height: `${(perMonth(m) / rowMax) * 100}%` }}
                      title={`${monthLabel(m)}: ${formatMoney(perMonth(m), currency)}`}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
