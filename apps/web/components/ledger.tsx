"use client";

import { ArrowDownLeft, ArrowUpRight, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/segmented";
import { card } from "@/components/summary";
import type { Category, Direction, Memo } from "@/lib/api";
import { dayLabel, groupByDay, signedAmount, signedMoney, timeLabel } from "@/lib/format";
import { STARTER_CATEGORIES, useAddStarterSet } from "@/lib/queries";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

export type DirectionFilter = "all" | Direction;
const ALL = "all";

export function Ledger({
  memos,
  categories,
  direction,
  onDirection,
  categoryId,
  onCategory,
  onSelect,
  onAdd,
}: {
  memos: Memo[] | undefined;
  categories: Category[];
  direction: DirectionFilter;
  onDirection: (d: DirectionFilter) => void;
  categoryId: string | undefined;
  onCategory: (id: string | undefined) => void;
  onSelect: (memo: Memo) => void;
  onAdd: () => void;
}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const options = categories.filter((c) => direction === "all" || c.direction === direction);
  const shown = memos?.filter((m) => direction === "all" || m.direction === direction);
  const filtered = direction !== "all" || !!categoryId;

  return (
    <section aria-labelledby="ledger-title" className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <h2 id="ledger-title" className="font-serif text-xl">
          Ledger
        </h2>
        {/* One row that scrolls sideways on narrow screens instead of wrapping. */}
        <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <Segmented
            size="sm"
            label="Filter by direction"
            className="shrink-0 snap-start"
            value={direction}
            onChange={onDirection}
            options={[
              { value: "all", label: "All" },
              { value: "income", label: "Income" },
              { value: "expense", label: "Expense" },
            ]}
          />
          <Select
            value={categoryId ?? ALL}
            onValueChange={(v) => onCategory(!v || v === ALL ? undefined : (v as string))}
            items={{ [ALL]: "All categories", ...Object.fromEntries(categories.map((c) => [c.id, `${c.emoji ? c.emoji + " " : ""}${c.name}`])) }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Filter by category"
              className="max-w-52 shrink-0 snap-start rounded-full bg-card px-3 data-[size=sm]:h-9 data-[size=sm]:rounded-full pointer-coarse:data-[size=sm]:h-11"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="end" className="rounded-xl p-1">
              <SelectItem value={ALL}>All categories</SelectItem>
              {options.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.emoji && <span aria-hidden>{c.emoji}</span>}
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!shown ? (
        <div className={cn(card, "space-y-3 p-4")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-2xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyLedger
          filtered={filtered}
          onClear={() => {
            onDirection("all");
            onCategory(undefined);
          }}
          onAdd={onAdd}
        />
      ) : (
        <div className="space-y-3">
          {groupByDay(shown).map((g) => (
            <div key={g.key}>
              {/* Sticks under the top bar while its day scrolls by. */}
              <div className="sticky top-[calc(var(--stick,0px)+3.5rem)] z-10 -mx-1 flex items-baseline justify-between gap-3 bg-background/90 px-2 pt-2 pb-2 backdrop-blur-sm md:top-[calc(var(--stick,0px)+4rem)]">
                <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{dayLabel(g.key)}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Object.entries(g.net)
                    .map(([cur, n]) => signedMoney(n, cur))
                    .join(" · ")}
                </span>
              </div>
              <ul className={cn(card, "divide-y divide-border/70 overflow-hidden rounded-2xl")}>
                {g.memos.map((m) => {
                  const c = m.category_id ? byId.get(m.category_id) : undefined;
                  const title = m.note || c?.name || "Untitled";
                  const income = m.direction === "income";
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        data-testid="memo-row"
                        onClick={() => onSelect(m)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                      >
                        <span
                          className={cn(
                            "flex size-10 shrink-0 items-center justify-center rounded-2xl text-lg",
                            income ? "bg-income-soft text-income" : "bg-expense-soft text-expense",
                          )}
                          aria-hidden
                        >
                          {c?.emoji ?? (income ? <ArrowDownLeft className="size-4.5" /> : <ArrowUpRight className="size-4.5" />)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.95rem] font-medium">{title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[m.note ? c?.name : null, timeLabel(m.occurred_at)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className={cn("num shrink-0 text-lg", income ? "text-income" : "text-expense")}>
                          {signedMoney(signedAmount(m), m.currency)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyLedger({ filtered, onClear, onAdd }: { filtered: boolean; onClear: () => void; onAdd: () => void }) {
  return (
    <div className={cn(card, "flex flex-col items-center px-6 py-10 text-center")}>
      <ReceiptArt />
      <p className="mt-4 font-serif text-lg">{filtered ? "Nothing matches these filters" : "A blank page"}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        {filtered ? "Try another category or direction." : "Jot down what came in and what went out. It takes five seconds."}
      </p>
      {filtered ? (
        <Button variant="outline" className="mt-5 rounded-full" onClick={onClear}>
          Clear filters
        </Button>
      ) : (
        <Button className="mt-5 rounded-full px-4" onClick={onAdd}>
          <Plus /> Add your first memo
        </Button>
      )}
    </div>
  );
}

function ReceiptArt() {
  return (
    <svg width="88" height="72" viewBox="0 0 88 72" fill="none" aria-hidden>
      <ellipse cx="44" cy="66" rx="30" ry="4" className="fill-muted" />
      <path d="M24 6h40v50l-5-4-5 4-5-4-5 4-5-4-5 4-5-4-5 4z" className="fill-card stroke-border" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M32 18h24M32 26h18M32 34h21" className="stroke-border" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="64" cy="14" r="9" className="fill-income-soft stroke-income" strokeWidth="1.5" />
      <path d="M60.5 14.2l2.4 2.4 4.6-5" className="stroke-income" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** First run: a user with no categories gets a one-click starter set. */
export function StarterCard() {
  const addStarter = useAddStarterSet();
  const online = useOnline();
  return (
    <section className={cn(card, "overflow-hidden border-income/25 bg-income-soft/50 p-5 md:p-6")} aria-labelledby="starter-title">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card text-income ring-1 ring-border">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="starter-title" className="font-serif text-xl">
            Start with a few categories
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Group your memos so the month tells a story. You can rename or remove them any time.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {STARTER_CATEGORIES.map((c) => (
          <span key={c.name} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-medium ring-1 ring-border">
            <span aria-hidden>{c.emoji}</span> {c.name}
          </span>
        ))}
      </div>
      <Button
        className="mt-5 h-10 rounded-full px-5"
        disabled={addStarter.isPending || !online}
        onClick={() =>
          addStarter.mutate(undefined, {
            onSuccess: () => toast.success("Starter categories added"),
            onError: (err) => toast.error(err.message),
          })
        }
      >
        {addStarter.isPending && <Loader2 className="animate-spin" />}
        Add starter set
      </Button>
    </section>
  );
}
