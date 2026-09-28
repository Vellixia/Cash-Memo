"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { card } from "@/components/summary";
import type { Category } from "@/lib/api";
import { currentMonth } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { useBudgets } from "@/lib/queries";
import { cn } from "@/lib/utils";

const level = (spent: number, limit: number) => (spent >= limit ? 100 : spent >= limit * 0.8 ? 80 : 0);

/** This month's budgets: spent (solid) and projected with recurring expenses (lighter). Hidden when there are none. */
export function BudgetsCard({ month, categories }: { month: string; categories: Category[] }) {
  const { data: budgets } = useBudgets(month);
  const byId = new Map(categories.map((c) => [c.id, c]));

  // In-app nudge, once per budget per month and level (80%, 100%). No push.
  useEffect(() => {
    if (!budgets || month !== currentMonth()) return;
    for (const b of budgets) {
      const reached = level(b.spent_minor, b.limit_minor);
      if (!reached) continue;
      const key = `budget-nudge:${b.id}:${month}`;
      try {
        if (Number(localStorage.getItem(key)) >= reached) continue;
        localStorage.setItem(key, String(reached));
      } catch {
        continue; // no storage: stay quiet rather than nag on every render
      }
      const name = categories.find((c) => c.id === b.category_id)?.name ?? "A category";
      if (reached === 100) toast.warning(`${name} is over budget this month`);
      else toast(`${name} has used 80% of its budget`);
    }
  }, [budgets, month, categories]);

  if (!budgets?.length) return null;
  return (
    <section className={cn(card, "p-4 sm:p-6")} aria-labelledby="budgets-title" data-testid="budgets-card">
      <h2 id="budgets-title" className="font-serif text-lg sm:text-xl">
        Budgets
      </h2>
      <ul className="mt-1.5 divide-y divide-border/70">
        {budgets.map((b) => {
          const c = byId.get(b.category_id);
          const name = c?.name ?? "Category";
          const spent = b.spent_minor / b.limit_minor;
          const projected = b.projected_minor / b.limit_minor;
          const reached = level(b.spent_minor, b.limit_minor);
          const tone = reached === 100 ? "bg-expense" : reached === 80 ? "bg-amber-500" : "bg-income";
          const note =
            reached === 100
              ? "Over budget"
              : reached === 80
                ? "Almost at the limit"
                : projected >= 1
                  ? "Recurring expenses will take it over"
                  : null;
          return (
            <li key={b.id} data-testid="budget-row" className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {c?.emoji && <span aria-hidden>{c.emoji}</span>}
                  <span className="truncate text-sm font-medium">{name}</span>
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground">
                  {formatMoney(b.spent_minor, b.currency)} / {formatMoney(b.limit_minor, b.currency)}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${name} budget`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(spent * 100)}
                className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className={cn("absolute inset-y-0 left-0 rounded-full opacity-35", tone)} style={{ width: `${Math.min(projected, 1) * 100}%` }} />
                <div className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.min(spent, 1) * 100}%` }} />
              </div>
              {note && (
                <p className={cn("mt-1 text-xs", reached === 100 ? "text-expense" : "text-muted-foreground")}>
                  {note}
                  {b.projected_minor > b.spent_minor && ` · ${formatMoney(b.projected_minor, b.currency)} projected`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
