"use client";

import { useEffect, useState } from "react";
import { MonthSwitcher } from "@/components/month-switcher";
import { BalancesCard, CreditReminders, CurrenciesCard, HeroCard, SpendingCard } from "@/components/summary";
import { Ledger, StarterCard, type DirectionFilter } from "@/components/ledger";
import { BudgetsCard } from "@/components/budgets-card";
import { useCategories, useMe, useMemos, useSources, useSummary, useUpcoming } from "@/lib/queries";
import { useUiStore } from "@/lib/store";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export default function HomePage() {
  const month = useUiStore((s) => s.month);
  const storedCurrency = useUiStore((s) => s.currency);
  const setCurrency = useUiStore((s) => s.setCurrency);
  const openEditor = useUiStore((s) => s.openEditor);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const categoryId = useUiStore((s) => s.ledgerCategoryId);
  const setCategoryId = useUiStore((s) => s.setLedgerCategoryId);
  const currencyFilter = useUiStore((s) => s.ledgerCurrency);
  const setCurrencyFilter = useUiStore((s) => s.setLedgerCurrency);
  const [sourceId, setSourceId] = useState<string | undefined>();

  // Reports drill-down arrives as ?month=&category=&currency=. Apply once, then drop the params
  // so a reload or the month switcher doesn't fight a stale URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    const { searchParams: params } = url;
    const monthParam = params.get("month");
    const categoryParam = params.get("category");
    const currencyParam = params.get("currency");
    if (monthParam === null && categoryParam === null && currencyParam === null) return;
    const st = useUiStore.getState();
    if (monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) st.setMonth(monthParam);
    if (categoryParam && UUID.test(categoryParam)) st.setLedgerCategoryId(categoryParam);
    if (currencyParam && /^[A-Z]{3}$/.test(currencyParam)) {
      st.setCurrency(currencyParam);
      st.setLedgerCurrency(currencyParam);
    }
    for (const k of ["month", "category", "currency"]) params.delete(k);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

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
        currency={currencyFilter}
        onClearCurrency={() => setCurrencyFilter(undefined)}
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
