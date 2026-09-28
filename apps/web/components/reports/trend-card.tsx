"use client";

import { card } from "@/components/summary";
import { Skeleton } from "@/components/ui/skeleton";
import type { Trend } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** "2026-03" -> "Mar". Local-safe: parsed as a plain date, not a UTC instant. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

/** Income vs expense per month, as paired bars — the same income/expense split Home's hero
 * card uses, just one column per month instead of one bar. */
export function IncomeExpenseTrendCard({ trend, currency }: { trend: Trend | undefined; currency: string }) {
  if (!trend) return <Skeleton className="h-64 rounded-3xl" />;
  const rows = trend.months.map((month) => {
    const at = (direction: "income" | "expense") =>
      trend.totals.find((t) => t.month === month && t.currency === currency && t.direction === direction)?.total_minor ?? 0;
    return { month, income: at("income"), expense: at("expense") };
  });
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expense]));

  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="trend-title">
      <h2 id="trend-title" className="font-serif text-lg sm:text-xl">
        Income vs expense
      </h2>
      <div className="mt-4 flex items-end gap-1.5 sm:gap-3" role="img" aria-label="Income and expense per month">
        {rows.map((r) => (
          <div key={r.month} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex h-32 w-full items-end gap-0.5 sm:gap-1" title={`${monthLabel(r.month)}: income ${formatMoney(r.income, currency)}, expense ${formatMoney(r.expense, currency)}`}>
              <div className="flex-1 rounded-t-sm bg-income transition-[height] duration-500" style={{ height: `${(r.income / max) * 100}%` }} />
              <div className="flex-1 rounded-t-sm bg-expense transition-[height] duration-500" style={{ height: `${(r.expense / max) * 100}%` }} />
            </div>
            <span className="text-[0.65rem] text-muted-foreground">{monthLabel(r.month)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-income" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-expense" /> Expense
        </span>
      </div>
    </section>
  );
}
