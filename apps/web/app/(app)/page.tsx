"use client";

import { useEffect, useState } from "react";
import { MonthSwitcher } from "@/components/month-switcher";
import { BalancesCard, CreditReminders, CurrenciesCard, HeroCard, SpendingCard } from "@/components/summary";
import { Ledger, StarterCard, type DirectionFilter } from "@/components/ledger";
import { BudgetsCard } from "@/components/budgets-card";
import { useCategories, useMe, useMemos, useSources, useSummary, useUpcoming } from "@/lib/queries";
import { useUiStore } from "@/lib/store";

export default function HomePage() {
  const month = useUiStore((s) => s.month);
  const storedCurrency = useUiStore((s) => s.currency);
  const setCurrency = useUiStore((s) => s.setCurrency);
  const openEditor = useUiStore((s) => s.openEditor);
  const setMonth = useUiStore((s) => s.setMonth);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [categoryId, setCategoryId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const value = new URLSearchParams(window.location.search).get("category");
    return value && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
  });
  const [sourceId, setSourceId] = useState<string | undefined>();

  // Reports drill-down reuses Home ledger filters; only accept valid URL values.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const monthParam = params.get("month");
    if (monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) setMonth(monthParam);
  }, [setMonth]);

  const { data: summary } = useSummary(month);
  const { data: memos } = useMemos(month, categoryId, sourceId);
  const { data: categories } = useCategories();
  const { data: sources } = useSources();
  const { data: upcoming } = useUpcoming(month);
  const defaultCurrency = useMe().data?.default_currency ?? "USD";

  // The default currency leads the switcher (and is selected) whenever the month has it.
  const currencies = [...new Set(summary?.totals.map((t) => t.currency) ?? [])].sort(
    (a, b) => Number(b === defaultCurrency) - Number(a === defaultCurrency),
  );
  const currency =
    [storedCurrency, defaultCurrency].find((c): c is string => !!c && currencies.includes(c)) ?? currencies[0] ?? defaultCurrency;

  return (
    // Phones/tablets: one column. Desktop: a sticky summary column beside the ledger.
    <div className="flex flex-col gap-3.5 sm:gap-5 lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <aside
        data-testid="summary-column"
        aria-label="Month summary"
        className="flex flex-col gap-3.5 sm:gap-5 lg:sticky lg:top-[calc(var(--stick,0px)+6rem)] lg:max-h-[calc(100dvh-var(--stick,0px)-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:px-1 lg:pb-2 lg:-mx-1"
      >
        <MonthSwitcher />
        {categories?.length === 0 && <StarterCard />}
        <div className="grid gap-3.5 sm:gap-5 md:grid-cols-2 lg:grid-cols-1">
          <HeroCard summary={summary} currency={currency} currencies={currencies} onCurrency={setCurrency} />
          <SpendingCard summary={summary} currency={currency} categories={categories ?? []} />
        </div>
        <CreditReminders sources={sources} />
        <BalancesCard sources={sources} />
        <BudgetsCard month={month} categories={categories ?? []} />
        {summary && currencies.length >= 2 && <CurrenciesCard summary={summary} currencies={currencies} />}
      </aside>
      <Ledger
        memos={memos}
        categories={categories ?? []}
        sources={sources ?? []}
        direction={direction}
        onDirection={(d) => {
          setDirection(d);
          const selected = categories?.find((c) => c.id === categoryId);
          if (selected && d !== "all" && selected.direction !== d) setCategoryId(undefined);
        }}
        categoryId={categoryId}
        onCategory={setCategoryId}
        sourceId={sourceId}
        onSource={setSourceId}
        onSelect={(m) => openEditor(m)}
        onAdd={() => openEditor()}
        upcoming={upcoming}
      />
    </div>
  );
}
