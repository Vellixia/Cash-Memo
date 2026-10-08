"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { card } from "@/components/summary";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category, Trend } from "@/lib/api";
import { topSpending } from "@/lib/report-insights";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export function TopSpendingCard({ trend, currency, categories, months, drillDown }: {
  trend: Trend | undefined;
  currency: string;
  categories: Category[];
  months: string[];
  drillDown: boolean;
}) {
  if (!trend) return <Skeleton className="h-48 rounded-3xl" />;
  const top = topSpending(trend, currency, months).slice(0, 5);
  const byId = new Map(categories.map((c) => [c.id, c]));

  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="top-spending-title">
      <h2 id="top-spending-title" className="font-serif text-lg sm:text-xl">Top spending</h2>
      <p className="mt-1 text-xs text-muted-foreground">Largest expense categories in selected period</p>
      {top.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No expenses in {currency} for this period.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/70">
          {top.map((r) => {
            const c = r.key === "uncategorized" ? undefined : byId.get(r.key);
            const name = c?.name ?? "Uncategorized";
            const body = (
              <>
                <span className="min-w-0 truncate text-sm font-medium">{c?.emoji && <span aria-hidden className="mr-1">{c.emoji}</span>}{name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="num text-sm">{formatMoney(r.amount, currency)}</span>
                  <span className="num w-9 text-right text-xs text-muted-foreground">{r.share}%</span>
                  {drillDown && c && <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />}
                </span>
              </>
            );
            return (
              <li key={r.key}>
                {drillDown && c ? (
                  <Link href={`/?month=${months[months.length - 1]}&category=${r.key}`} aria-label={`View ${name} memos`} className="flex min-h-11 items-center justify-between gap-2 rounded-md py-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">{body}</Link>
                ) : <div className="flex min-h-11 items-center justify-between gap-2 py-2">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
