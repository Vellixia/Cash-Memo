"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../components/ui/sheet";
import { Button } from "../../components/ui/button";

export interface HistoryFilters {
  from?: string;
  to?: string;
  type?: string;
  wallet?: string;
  category?: string;
}

const STRUCTURED_KEYS = ["from", "to", "type", "wallet", "category"] as const;

export function readHistoryFilters(search: URLSearchParams): HistoryFilters {
  return Object.fromEntries(
    STRUCTURED_KEYS.flatMap((key) => {
      const value = search.get(key);
      return value ? [[key, value]] : [];
    }),
  );
}

function applyUrl(pathname: string, filters: HistoryFilters) {
  const next = new URLSearchParams();
  for (const key of STRUCTURED_KEYS) {
    const value = filters[key];
    if (value) next.set(key, value);
  }
  return `${pathname}${next.size ? `?${next.toString()}` : ""}`;
}

interface ControlsProps {
  filters: HistoryFilters;
  query: string;
  onFilterChange: (key: keyof HistoryFilters, value: string) => void;
  onQueryChange: (value: string) => void;
}

function Controls({ filters, query, onFilterChange, onQueryChange }: ControlsProps) {
  return (
    <>
      <label>
        From
        <input className="input" type="date" value={filters.from ?? ""} onChange={(event) => onFilterChange("from", event.target.value)} />
      </label>
      <label>
        To
        <input className="input" type="date" value={filters.to ?? ""} onChange={(event) => onFilterChange("to", event.target.value)} />
      </label>
      <label>
        Type
        <select className="input" value={filters.type ?? ""} onChange={(event) => onFilterChange("type", event.target.value)}>
          <option value="">All</option>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </label>
      <label>
        Wallet
        <input className="input" value={filters.wallet ?? ""} onChange={(event) => onFilterChange("wallet", event.target.value)} />
      </label>
      <label>
        Category
        <input className="input" value={filters.category ?? ""} onChange={(event) => onFilterChange("category", event.target.value)} />
      </label>
      <label>
        Search
        <input aria-label="Search" className="input" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search notes" />
      </label>
    </>
  );
}

export function TransactionFilters({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filterKey = search.toString();
  const filters = readHistoryFilters(search);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<HistoryFilters>(filters);
  const [draftQuery, setDraftQuery] = useState(query);

  useEffect(() => {
    setDraft(filters);
    setDraftQuery(query);
  }, [filterKey, query]);

  useEffect(() => {
    if (search.has("q")) router.replace(applyUrl(pathname, filters));
  }, [pathname, router, search, filterKey]);

  function updateStructured(key: keyof HistoryFilters, value: string) {
    router.replace(applyUrl(pathname, { ...filters, [key]: value || undefined }));
  }

  function applyDraft() {
    router.replace(applyUrl(pathname, draft));
    onQueryChange(draftQuery);
    setOpen(false);
  }

  function clearAll() {
    setDraft({});
    setDraftQuery("");
    router.replace(pathname);
    onQueryChange("");
    setOpen(false);
  }

  return (
    <>
      <fieldset className="transaction-filters transaction-filters-desktop">
        <legend>Filters</legend>
        <Controls filters={filters} query={query} onFilterChange={updateStructured} onQueryChange={onQueryChange} />
      </fieldset>
      <div className="transaction-filters-mobile">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<Button type="button" variant="secondary" />}>Filters</SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Choose filters, then apply once.</SheetDescription>
            </SheetHeader>
            <fieldset className="transaction-filters">
              <legend className="sr-only">Transaction filters</legend>
              <Controls
                filters={draft}
                query={draftQuery}
                onFilterChange={(key, value) => setDraft((current) => ({ ...current, [key]: value || undefined }))}
                onQueryChange={setDraftQuery}
              />
            </fieldset>
            <SheetFooter>
              <Button type="button" variant="quiet" onClick={clearAll}>Clear all</Button>
              <Button type="button" onClick={applyDraft}>Apply filters</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
