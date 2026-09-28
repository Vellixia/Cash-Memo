"use client";

import { card } from "@/components/summary";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category, Trend } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Per-category delta between the two most recent months in range, biggest swings first. */
export function MonthComparisonCard({ trend, currency, categories }: { trend: Trend | undefined; currency: string; categories: Category[] }) {
  if (!trend) return <Skeleton className="h-48 rounded-3xl" />;
  const thisMonth = trend.months[trend.months.length - 1];
  const lastMonth = trend.months[trend.months.length - 2];
  if (!thisMonth || !lastMonth) return null;

  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = trend.by_category.filter((r) => r.currency === currency && (r.month === thisMonth || r.month === lastMonth));
  const totalFor = (month: string, key: string) => rows.find((r) => r.month === month && (r.category_id ?? "none") === key)?.total_minor ?? 0;
  const keys = new Set(rows.map((r) => r.category_id ?? "none"));
  const deltas = [...keys]
    .map((key) => {
      const now = totalFor(thisMonth, key);
      const before = totalFor(lastMonth, key);
      return { key, now, before, delta: now - before };
    })
    .filter((r) => r.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="comparison-title">
      <h2 id="comparison-title" className="font-serif text-lg sm:text-xl">
        This month vs last
      </h2>
      {deltas.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No change by category in {currency} yet.</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-border/70">
          {deltas.map((r) => {
            const c = r.key !== "none" ? byId.get(r.key) : undefined;
            const up = r.delta > 0;
            return (
              <li key={r.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {c?.emoji && <span aria-hidden>{c.emoji}</span>}
                  {c?.name ?? "Uncategorized"}
                </span>
                <span className={cn("num shrink-0", up ? "text-expense" : "text-income")}>
                  {up ? "+" : "−"}
                  {formatMoney(Math.abs(r.delta), currency)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
