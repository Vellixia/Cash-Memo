"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { card } from "@/components/summary";
import { monthLabel } from "@/components/reports/trend-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category, Trend } from "@/lib/api";
import { categoryChanges, changePercent, completedComparisonMonths, totalsFor } from "@/lib/report-insights";
import { signedMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function percentage(before: number, now: number, isNet = false): string {
  const pct = changePercent(before, now);
  if (pct === null) return !isNet && before === 0 && now > 0 ? "New" : "—";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export function MonthComparisonCard({ trend, currency, categories }: { trend: Trend | undefined; currency: string; categories: Category[] }) {
  if (!trend) return <Skeleton className="h-56 rounded-3xl" />;
  const pair = completedComparisonMonths(trend);
  if (!pair) return null;

  const previous = totalsFor(trend, currency, [pair.previous]);
  const current = totalsFor(trend, currency, [pair.current]);
  const changes = categoryChanges(trend, currency, pair.previous, pair.current).slice(0, 5);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const summary = [
    { label: "Spending", before: previous.expense, now: current.expense, positiveGood: false },
    { label: "Income", before: previous.income, now: current.income, positiveGood: true },
    { label: "Net", before: previous.net, now: current.net, positiveGood: true },
  ];

  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="comparison-title">
      <h2 id="comparison-title" className="font-serif text-lg sm:text-xl">Compared with previous month</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {monthLabel(pair.current)} vs {monthLabel(pair.previous)} · both complete months, excluding current month-to-date
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {summary.map((item) => {
          const delta = item.now - item.before;
          return (
            <div key={item.label} className="min-w-0 rounded-xl bg-muted/50 p-2.5 sm:p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={cn("num mt-1 break-words text-xs font-semibold sm:text-base", delta === 0 ? "" : (delta > 0) === item.positiveGood ? "text-income" : "text-expense")}>{signedMoney(delta, currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{percentage(item.before, item.now, item.label === "Net")}</p>
            </div>
          );
        })}
      </div>
      <h3 className="mt-5 text-sm font-semibold">Biggest category changes</h3>
      {changes.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No category spending changes in {currency}.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border/70">
          {changes.map((change) => {
            const category = change.key === "uncategorized" ? undefined : categoryById.get(change.key);
            const name = category?.name ?? "Uncategorized";
            const contents = (
              <>
                <span className="min-w-0 truncate text-sm">
                  {category?.emoji && <span aria-hidden className="mr-1">{category.emoji}</span>}{name}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={cn("num text-sm font-medium", change.delta > 0 ? "text-expense" : "text-income")}>{signedMoney(change.delta, currency)}</span>
                  <span className="num w-12 text-right text-xs text-muted-foreground">{percentage(change.before, change.now)}</span>
                  {category && <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />}
                </span>
              </>
            );
            return (
              <li key={change.key}>
                {category ? (
                  <Link href={`/?month=${pair.current}&category=${change.key}`} aria-label={`View ${name} memos in ${monthLabel(pair.current)}`} className="flex min-h-11 items-center justify-between gap-2 rounded-md py-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">{contents}</Link>
                ) : (
                  <div className="flex min-h-11 items-center justify-between gap-2 py-2">{contents}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
