"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface HistoryFilters { from?: string; to?: string; type?: string; wallet?: string; category?: string; q?: string }

export function readHistoryFilters(search: URLSearchParams): HistoryFilters {
  return Object.fromEntries(["from", "to", "type", "wallet", "category", "q"].flatMap((key) => {
    const value = search.get(key); return value ? [[key, value]] : [];
  }));
}

export function TransactionFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filters = readHistoryFilters(search);
  function update(key: keyof HistoryFilters, value: string) {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`);
  }
  return <fieldset className="transaction-filters"><legend>Filters</legend>
    <label>From<input className="input" type="date" value={filters.from ?? ""} onChange={(event) => { update("from", event.target.value); }} /></label>
    <label>To<input className="input" type="date" value={filters.to ?? ""} onChange={(event) => { update("to", event.target.value); }} /></label>
    <label>Type<select className="input" value={filters.type ?? ""} onChange={(event) => { update("type", event.target.value); }}><option value="">All</option><option value="expense">Expense</option><option value="income">Income</option></select></label>
    <label>Wallet<input className="input" value={filters.wallet ?? ""} onChange={(event) => { update("wallet", event.target.value); }} /></label>
    <label>Category<input className="input" value={filters.category ?? ""} onChange={(event) => { update("category", event.target.value); }} /></label>
    <label>Search<input aria-label="Search" className="input" value={filters.q ?? ""} onChange={(event) => { update("q", event.target.value); }} placeholder="Literal search" /></label>
  </fieldset>;
}
