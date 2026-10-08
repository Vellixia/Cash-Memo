"use client";

import { useState } from "react";
import { MonthComparisonCard } from "@/components/reports/comparison-card";
import { TopSpendingCard } from "@/components/reports/top-spending-card";
import { IncomeExpenseTrendCard } from "@/components/reports/trend-card";
import { Segmented } from "@/components/segmented";
import { card } from "@/components/summary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useMe, useTrend } from "@/lib/queries";
import { monthsForRange, totalsFor, type ReportRange } from "@/lib/report-insights";
import { useUiStore } from "@/lib/store";
import { formatMoney, signedMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ReportRange; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "3", label: "3M" },
  { value: "6", label: "6M" },
  { value: "12", label: "12M" },
];

export default function ReportsPage() {
  const [range, setRange] = useState<ReportRange>("month");
  // 3 months needed even in "This month" to compare last two completed months.
  const months = range === "month" ? 3 : Number(range) as 3 | 6 | 12;
  const { data: trend, isError, refetch } = useTrend(months);
  const { data: categories = [] } = useCategories();
  const storedCurrency = useUiStore((s) => s.currency);
  const setCurrency = useUiStore((s) => s.setCurrency);
  const defaultCurrency = useMe().data?.default_currency ?? "USD";

  const currencies = [...new Set(trend?.totals.map((t) => t.currency) ?? [])].sort(
    (a, b) => Number(b === defaultCurrency) - Number(a === defaultCurrency),
  );
  const currency = [storedCurrency, defaultCurrency].find((c): c is string => !!c && currencies.includes(c)) ?? currencies[0] ?? defaultCurrency;
  const selectedMonths = trend ? monthsForRange(trend, range) : [];
  const totals = trend ? totalsFor(trend, currency, selectedMonths) : null;
  const label = range === "month" ? "This month to date" : `Last ${range} months · current month to date`;
  const savings = totals && totals.income > 0 ? Math.round((totals.net / totals.income) * 100) : null;

  return (
    <div className="space-y-3.5 sm:space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl">Insights</h1>
          <p className="text-sm text-muted-foreground">What changed, and where did the money go?</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {currencies.length > 1 && (
            <Segmented size="sm" label="Currency" value={currency} onChange={setCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
          )}
          <Segmented size="sm" label="Date range" value={range} onChange={setRange} options={OPTIONS} />
        </div>
      </header>

      {isError && (
        <div role="alert" className={cn(card, "flex items-center justify-between gap-3 p-4")}>
          <span>Could not load insights.</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}

      {!totals ? <Skeleton className="h-32 rounded-3xl" /> : (
        <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="financial-summary-title">
          <div className="mb-4">
            <h2 id="financial-summary-title" className="font-serif text-lg sm:text-xl">Financial overview</h2>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Income</dt>
              <dd data-testid="insight-income" className="num mt-1 break-words text-base font-semibold text-income sm:text-xl">{formatMoney(totals.income, currency)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Expense</dt>
              <dd data-testid="insight-expense" className="num mt-1 break-words text-base font-semibold text-expense sm:text-xl">{formatMoney(totals.expense, currency)}</dd>
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">Net</dt>
              <dd data-testid="insight-net" className={cn("num mt-1 break-words text-base font-semibold sm:text-xl", totals.net >= 0 ? "text-income" : "text-expense")}>{signedMoney(totals.net, currency)}</dd>
              {savings !== null && <p className="mt-1 text-xs text-muted-foreground">{savings}% savings rate</p>}
            </div>
          </dl>
        </section>
      )}

      <IncomeExpenseTrendCard trend={trend} currency={currency} />
      <MonthComparisonCard trend={trend} currency={currency} categories={categories} />
      <TopSpendingCard trend={trend} currency={currency} categories={categories} months={selectedMonths} drillDown={range === "month"} />
    </div>
  );
}
