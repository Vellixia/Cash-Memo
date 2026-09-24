"use client";

import { useState } from "react";
import { MonthSwitcher } from "@/components/month-switcher";
import { HeroCard, SpendingCard } from "@/components/summary";
import { Ledger, StarterCard, type DirectionFilter } from "@/components/ledger";
import { useCategories, useMemos, useSummary } from "@/lib/queries";
import { useUiStore } from "@/lib/store";

export default function HomePage() {
  const month = useUiStore((s) => s.month);
  const storedCurrency = useUiStore((s) => s.currency);
  const setCurrency = useUiStore((s) => s.setCurrency);
  const lastCurrency = useUiStore((s) => s.lastCurrency);
  const openEditor = useUiStore((s) => s.openEditor);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [categoryId, setCategoryId] = useState<string | undefined>();

  const { data: summary } = useSummary(month);
  const { data: memos } = useMemos(month, categoryId);
  const { data: categories } = useCategories();

  const currencies = [...new Set(summary?.totals.map((t) => t.currency) ?? [])];
  const currency =
    [storedCurrency, lastCurrency].find((c): c is string => !!c && currencies.includes(c)) ?? currencies[0] ?? lastCurrency;

  return (
    <div className="space-y-5 md:space-y-6">
      <MonthSwitcher />
      {categories?.length === 0 && <StarterCard />}
      <HeroCard summary={summary} currency={currency} currencies={currencies} onCurrency={setCurrency} />
      <SpendingCard summary={summary} currency={currency} categories={categories ?? []} />
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
