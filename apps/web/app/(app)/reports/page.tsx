"use client";

import { CategoryTrendCard } from "@/components/reports/category-trend-card";
import { MonthComparisonCard } from "@/components/reports/comparison-card";
import { IncomeExpenseTrendCard } from "@/components/reports/trend-card";
import { Segmented } from "@/components/segmented";
import { useCategories, useMe, useTrend } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { useState } from "react";

export default function ReportsPage() {
  const [months, setMonths] = useState<"6" | "12">("6");
  const storedCurrency = useUiStore((s) => s.currency);
  const setCurrency = useUiStore((s) => s.setCurrency);
  const { data: trend } = useTrend(Number(months) as 6 | 12);
  const { data: categories } = useCategories();
  const defaultCurrency = useMe().data?.default_currency ?? "USD";

  // Same "default currency leads, stays selected when present" pattern as Home.
  const currencies = [...new Set(trend?.totals.map((t) => t.currency) ?? [])].sort(
    (a, b) => Number(b === defaultCurrency) - Number(a === defaultCurrency),
  );
  const currency = [storedCurrency, defaultCurrency].find((c): c is string => !!c && currencies.includes(c)) ?? currencies[0] ?? defaultCurrency;

  return (
    <div className="space-y-3.5 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl">Reports</h1>
        <div className="flex items-center gap-2">
          {currencies.length > 1 && (
            <Segmented size="sm" label="Currency" value={currency} onChange={setCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
          )}
          <Segmented
            size="sm"
            label="Date range"
            value={months}
            onChange={setMonths}
            options={[
              { value: "6", label: "6 mo" },
              { value: "12", label: "12 mo" },
            ]}
          />
        </div>
      </div>

      <IncomeExpenseTrendCard trend={trend} currency={currency} />
      <CategoryTrendCard trend={trend} currency={currency} categories={categories ?? []} />
      <MonthComparisonCard trend={trend} currency={currency} categories={categories ?? []} />
    </div>
  );
}
