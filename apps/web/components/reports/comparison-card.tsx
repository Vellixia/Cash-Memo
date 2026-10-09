"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { card } from "@/components/summary";
import { dateRangeLabel, monthLabel } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category, ReportCompare } from "@/lib/api";
import { categoryChanges, changePercent, periodTotals } from "@/lib/report-insights";
import { signedMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

function percentage(before: number, now: number, isNet = false): string {
  const pct = changePercent(before, now);
  if (pct === null) return !isNet && before === 0 && now > 0 ? "New" : "—";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/** `drillDown`: only a single-month window can be shown in the month-scoped Home ledger. */
export function PeriodComparisonCard({ compare, currency, categories, drillDown }: {
  compare: ReportCompare | undefined;
  currency: string;
  categories: Category[];
  drillDown: boolean;
}) {
  if (!compare) return <Skeleton className="h-56 rounded-3xl" />;
  const previous = periodTotals(compare.previous, currency);
  const current = periodTotals(compare.current, currency);
  const changes = categoryChanges(compare.previous, compare.current, currency).slice(0, 5);
  const month = compare.current.end.slice(0, 7);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const summary = [
    { label: "Spending", before: previous.expense, now: current.expense, positiveGood: false },
    { label: "Income", before: previous.income, now: current.income, positiveGood: true },
    { label: "Net", before: previous.net, now: current.net, positiveGood: true },
  ];

  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="comparison-title">
      <h2 id="comparison-title" className="font-serif text-lg sm:text-xl">Compared with previous period</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {dateRangeLabel(compare.current.start, compare.current.end)} vs {dateRangeLabel(compare.previous.start, compare.previous.end)}
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
                  {drillDown && category && <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden />}
                </span>
              </>
            );
            return (
              <li key={change.key}>
                {drillDown && category ? (
                  <Link href={`/?month=${month}&category=${change.key}&currency=${currency}`} aria-label={`View ${name} memos in ${monthLabel(month, "short")}`} className="flex min-h-11 items-center justify-between gap-2 rounded-md py-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40">{contents}</Link>
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
