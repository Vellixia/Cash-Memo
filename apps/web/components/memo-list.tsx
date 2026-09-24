"use client";

import { formatMoney, type Category, type Memo } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Receipt } from "lucide-react";

function dayLabel(date: Date, today: Date): string {
  const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((t0 - d0) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Memos grouped by day, newest first, with sticky day headers and a per-day net. */
export function MemoList({
  memos,
  categories,
  onSelect,
}: {
  memos: Memo[];
  categories: Category[];
  onSelect: (memo: Memo) => void;
}) {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const today = new Date();

  const groups = new Map<string, { date: Date; memos: Memo[] }>();
  for (const memo of memos) {
    const date = new Date(memo.occurred_at);
    const key = dayKey(date);
    if (!groups.has(key)) groups.set(key, { date, memos: [] });
    groups.get(key)!.memos.push(memo);
  }

  if (memos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No memos in this month yet — add your first one.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      {[...groups.values()].map(({ date, memos: dayMemos }) => {
        const netByCurrency = new Map<string, number>();
        for (const m of dayMemos) {
          const sign = m.direction === "income" ? 1 : -1;
          netByCurrency.set(m.currency, (netByCurrency.get(m.currency) ?? 0) + sign * m.amount_minor);
        }

        return (
          <div key={dayKey(date)}>
            <div className="sticky top-[calc(var(--header-h,0px))] flex items-baseline justify-between border-b bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <span>{dayLabel(date, today)}</span>
              <span className="tabular-nums">
                {[...netByCurrency.entries()]
                  .map(([currency, net]) => `${net >= 0 ? "+" : "−"}${formatMoney(Math.abs(net), currency)}`)
                  .join(" · ")}
              </span>
            </div>
            <ul className="divide-y">
              {dayMemos.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(m)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                        m.direction === "income"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                      }`}
                    >
                      <Receipt className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m.note || (m.category_id ? nameById.get(m.category_id) : null) || "Uncategorized"}
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{new Date(m.occurred_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                        {m.category_id && nameById.get(m.category_id) && m.note && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            {nameById.get(m.category_id)}
                          </Badge>
                        )}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-medium tabular-nums ${
                        m.direction === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {m.direction === "income" ? "+" : "−"}
                      {formatMoney(m.amount_minor, m.currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
