"use client";

import { useState } from "react";
import { MonthSwitcher } from "@/components/month-switcher";
import { CurrenciesCard, HeroCard, SpendingCard } from "@/components/summary";
import { Ledger, StarterCard, type DirectionFilter } from "@/components/ledger";
import { useCategories, useMe, useMemos, useSummary } from "@/lib/queries";
import { useUiStore } from "@/lib/store";

export default function HomePage() {
  const month = useUiStore((s) => s.month);
  const storedCurrency = useUiStore((s) => s.currency);
  const setCurrency = useUiStore((s) => s.setCurrency);
  const openEditor = useUiStore((s) => s.openEditor);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [categoryId, setCategoryId] = useState<string | undefined>();

  const { data: summary } = useSummary(month);
  const { data: memos } = useMemos(month, categoryId);
  const { data: categories } = useCategories();
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
        {summary && currencies.length >= 2 && <CurrenciesCard summary={summary} currencies={currencies} />}
      </aside>
      <Ledger
        memos={memos}
        categories={categories ?? []}
        direction={direction}
        onDirection={(d) => {
          setDirection(d);
          const selected = categories?.find((c) => c.id === categoryId);
          if (selected && d !== "all" && selected.direction !== d) setCategoryId(undefined);
        }}
        categoryId={categoryId}
        onCategory={setCategoryId}
        onSelect={(m) => openEditor(m)}
        onAdd={() => openEditor()}
      />
    </div>
  );
}
