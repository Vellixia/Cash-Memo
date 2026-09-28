"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MemoRow } from "@/components/ledger";
import { card } from "@/components/summary";
import { dayLabel, groupByDay } from "@/lib/format";
import { useCategories, useSearchMemos, useSources } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Debounces a fast-changing value; the effect only fires `delay`ms after the last change. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchInner />
    </Suspense>
  );
}

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const debounced = useDebounced(q.trim(), 300);

  const { data: categories = [] } = useCategories();
  const { data: sources = [] } = useSources();
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const openEditor = useUiStore((s) => s.openEditor);

  const search = useSearchMemos(debounced);
  const memos = search.data?.pages.flat() ?? [];
  const tooShort = debounced.length > 0 && debounced.length < 2;

  // Keeps the query shareable/reloadable without piling up history entries.
  useEffect(() => {
    router.replace(debounced ? `/search?q=${encodeURIComponent(debounced)}` : "/search", { scroll: false });
  }, [debounced, router]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <h1 className="font-serif text-2xl tracking-tight">Search</h1>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="search-input"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notes, categories, sources…"
          aria-label="Search memos"
          className="h-12 rounded-2xl bg-card pr-4 pl-11 text-base"
        />
      </div>

      {tooShort ? (
        <p className="px-1 text-sm text-muted-foreground">Keep typing (at least 2 characters).</p>
      ) : debounced.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Search your notes, categories and sources across every month.</p>
      ) : search.isLoading ? (
        <div className={cn(card, "space-y-3 p-4")}>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-2xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : memos.length === 0 ? (
        <p className={cn(card, "rounded-2xl px-5 py-8 text-center text-sm text-muted-foreground")}>No memos match &ldquo;{debounced}&rdquo;.</p>
      ) : (
        <div className="space-y-3">
          {groupByDay(memos).map((g) => (
            <div key={g.key}>
              <h3 className="px-2 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{dayLabel(g.key)}</h3>
              <ul className={cn(card, "divide-y divide-border/70 overflow-hidden rounded-2xl")}>
                {g.memos.map((m) => (
                  <MemoRow key={m.id} memo={m} categoryById={categoryById} sourceById={sourceById} onSelect={openEditor} />
                ))}
              </ul>
            </div>
          ))}
          {search.hasNextPage && (
            <Button
              variant="outline"
              className="w-full rounded-full"
              onClick={() => search.fetchNextPage()}
              disabled={search.isFetchingNextPage}
            >
              {search.isFetchingNextPage && <Loader2 className="animate-spin" />}
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
