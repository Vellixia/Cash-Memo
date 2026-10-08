"use client";

import { useState } from "react";
import { card } from "@/components/summary";
import { Segmented } from "@/components/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import type { Trend } from "@/lib/api";
import { totalsFor } from "@/lib/report-insights";
import { formatMoney, signedMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Metric = "income" | "expense" | "net";

export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(year, number - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function IncomeExpenseTrendCard({ trend, currency }: { trend: Trend | undefined; currency: string }) {
  const [metric, setMetric] = useState<Metric>("expense");
  const [selected, setSelected] = useState<string | null>(null);
  if (!trend) return <Skeleton className="h-64 rounded-3xl" />;

  const rows = trend.months.map((month) => ({ month, ...totalsFor(trend, currency, [month]) }));
  const active = rows.find((row) => row.month === selected) ?? rows[rows.length - 1];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r[metric])));
  const bg = metric === "income" ? "bg-income" : "bg-expense";

  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="trend-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="trend-title" className="font-serif text-lg sm:text-xl">Monthly trend</h2>
          <p className="text-xs text-muted-foreground">Tap month for exact amounts. Current month shows activity to date.</p>
        </div>
        <Segmented size="sm" label="Trend metric" value={metric} onChange={setMetric} options={[
          { value: "income", label: "Income" },
          { value: "expense", label: "Expense" },
          { value: "net", label: "Net" },
        ]} />
      </div>
      <div className="mt-4 flex items-end gap-1 sm:gap-2" role="group" aria-label={`Monthly ${metric} values`}>
        {rows.map((row) => {
          const value = row[metric];
          const pct = Math.abs(value) / max * 100;
          const isActive = row.month === active?.month;
          return (
            <button
              type="button"
              key={row.month}
              aria-pressed={isActive}
              aria-label={`${monthLabel(row.month)}: ${metric} ${signedMoney(value, currency)}`}
              onClick={() => setSelected(row.month)}
              className={cn("min-w-0 flex-1 rounded-lg px-0.5 py-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40", isActive && "bg-muted ring-1 ring-border")}
            >
              {metric === "net" ? (
                <div className="relative flex h-32 flex-col">
                  <div className="flex h-1/2 items-end justify-center">
                    {value > 0 && <div className="w-3/4 rounded-t-sm bg-income" style={{ height: `${pct}%` }} />}
                  </div>
                  <div className="flex h-1/2 items-start justify-center">
                    {value < 0 && <div className="w-3/4 rounded-b-sm bg-expense" style={{ height: `${pct}%` }} />}
                  </div>
                  <div className="absolute inset-x-0 top-1/2 border-t border-border" />
                </div>
              ) : (
                <div className="flex h-32 items-end justify-center">
                  {value > 0 && <div className={cn("w-3/4 rounded-t-sm", bg)} style={{ height: `${pct}%` }} />}
                </div>
              )}
              <span className="mt-1 block truncate text-[0.65rem] text-muted-foreground">{monthLabel(row.month).split(" ")[0]}</span>
            </button>
          );
        })}
      </div>
      {active && (
        <div className="mt-3 border-t border-border/70 pt-3" aria-live="polite">
          <p className="mb-2 text-sm font-medium">{monthLabel(active.month)}</p>
          <dl className="grid grid-cols-3 gap-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Income</dt>
              <dd className="num break-words text-xs font-semibold sm:text-sm">{formatMoney(active.income, currency)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Expense</dt>
              <dd className="num break-words text-xs font-semibold sm:text-sm">{formatMoney(active.expense, currency)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Net</dt>
              <dd className="num break-words text-xs font-semibold sm:text-sm">{signedMoney(active.net, currency)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
