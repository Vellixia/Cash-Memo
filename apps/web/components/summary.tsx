"use client";

import { useState } from "react";
import { formatMoney, type Category, type Summary } from "@/lib/api";
import { CATEGORY_COLORS, signedMoney } from "@/lib/format";
import { Segmented } from "@/components/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const card = "rounded-3xl border border-border bg-card shadow-paper";

export function HeroCard({
  summary,
  currency,
  currencies,
  onCurrency,
}: {
  summary: Summary | undefined;
  currency: string;
  currencies: string[];
  onCurrency: (c: string) => void;
}) {
  if (!summary) return <Skeleton className="h-44 rounded-3xl sm:h-52" />;
  const total = (direction: string) =>
    summary.totals.find((t) => t.currency === currency && t.direction === direction)?.total_minor ?? 0;
  const income = total("income");
  const expense = total("expense");
  const net = income - expense;
  const sum = income + expense;
  const incomeShare = sum ? (income / sum) * 100 : 50;

  return (
    // Sizes follow the card's own width (@container): it sits full-width, half-width or in the desktop sidebar.
    <section className={cn(card, "@container relative flex flex-col overflow-hidden p-4 sm:p-6")} aria-label="This month">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Net this month</h2>
        {currencies.length > 1 && (
          <Segmented
            size="sm"
            label="Currency"
            value={currency}
            onChange={onCurrency}
            options={currencies.map((c) => ({ value: c, label: c }))}
          />
        )}
      </div>
      <p
        data-testid="hero-net"
        className={cn(
          "num mt-1.5 text-4xl leading-none [overflow-wrap:anywhere] @[22rem]:text-5xl lg:text-5xl @[30rem]:text-6xl",
          net > 0 && "text-income",
          net < 0 && "text-expense",
        )}
      >
        {signedMoney(net, currency)}
      </p>

      {/* Soaks up extra height when the card is stretched beside the donut card. */}
      <div className="flex-1" aria-hidden />
      <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-muted sm:mt-6" aria-hidden>
        {sum > 0 && (
          <>
            <div className="h-full bg-income transition-[width] duration-500" style={{ width: `${incomeShare}%` }} />
            <div className="h-full w-0.5 shrink-0 bg-card" />
            <div className="h-full flex-1 bg-expense" />
          </>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:mt-4">
        <div>
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-income" /> Income
          </dt>
          <dd data-testid="hero-income" className="num mt-0.5 text-xl [overflow-wrap:anywhere] text-foreground @[20rem]:text-2xl">
            {formatMoney(income, currency)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="flex items-center justify-end gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-expense" /> Expense
          </dt>
          <dd data-testid="hero-expense" className="num mt-0.5 text-xl [overflow-wrap:anywhere] text-foreground @[20rem]:text-2xl">
            {formatMoney(expense, currency)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

const TOP = 4;

export function SpendingCard({
  summary,
  currency,
  categories,
}: {
  summary: Summary | undefined;
  currency: string;
  categories: Category[];
}) {
  const [showAll, setShowAll] = useState(false);
  if (!summary) return <Skeleton className="h-44 rounded-3xl sm:h-56" />;
  const rows = summary.by_category.filter((r) => r.direction === "expense" && r.currency === currency);
  const total = rows.reduce((s, r) => s + r.total_minor, 0);
  const byId = new Map(categories.map((c) => [c.id, c]));

  // Colour follows the category (its position in the list), not its rank, so it stays put month to month.
  const slices = rows.map((r) => {
    const c = r.category_id ? byId.get(r.category_id) : undefined;
    return {
      key: r.category_id ?? "none",
      name: c?.name ?? "Uncategorized",
      emoji: c?.emoji ?? null,
      amount: r.total_minor,
      pct: total ? (r.total_minor / total) * 100 : 0,
      color: c ? CATEGORY_COLORS[categories.indexOf(c) % CATEGORY_COLORS.length] : "var(--muted-foreground)",
    };
  });

  let acc = 0;
  const gradient = slices.length
    ? `conic-gradient(${slices
        .map((s) => {
          const from = acc;
          acc += s.pct;
          return `${s.color} ${from}% ${acc}%`;
        })
        .join(", ")})`
    : "conic-gradient(var(--muted) 0 100%)";
  // The legend lists the biggest first and folds the tail away to keep the card short.
  const ranked = [...slices].sort((a, b) => b.amount - a.amount);
  const legend = showAll ? ranked : ranked.slice(0, TOP);
  const spent = formatMoney(total, currency);

  return (
    // Layout follows the card's own width: donut beside the legend when there's room, stacked when narrow.
    <section className={cn(card, "@container p-4 sm:p-6")} aria-labelledby="spending-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="spending-title" className="font-serif text-lg sm:text-xl">
          Spending by category
        </h2>
        {ranked.length > TOP && (
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls="donut-legend"
            onClick={() => setShowAll((v) => !v)}
            className="-my-2 -mr-2 min-h-11 rounded-xl px-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {showAll ? "Top 4" : `Show all ${ranked.length}`}
          </button>
        )}
      </div>
      {slices.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No expenses in {currency} this month yet.</p>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-4 @[18rem]:flex-row @[18rem]:items-start @[30rem]:mt-5 @[30rem]:items-center @[30rem]:gap-8">
          <div
            className="relative size-28 shrink-0 rounded-full @[18rem]:size-26 @[30rem]:size-40"
            style={{ background: gradient }}
            role="img"
            aria-label={`Spending donut chart, ${spent} spent`}
          >
            <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-card text-center">
              <span className="hidden text-[0.7rem] font-medium text-muted-foreground @[30rem]:block">Spent</span>
              <span className="num px-1 text-xs leading-tight @[30rem]:text-lg">{spent}</span>
            </div>
          </div>
          <div className="w-full min-w-0 flex-1">
            <ul id="donut-legend" className="divide-y divide-border/70" data-testid="donut-legend">
              {legend.map((s) => (
                <li key={s.key} className="flex items-center gap-2 py-1.5 text-sm @[30rem]:gap-3 @[30rem]:py-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {s.emoji && (
                      <span className="mr-1.5" aria-hidden>
                        {s.emoji}
                      </span>
                    )}
                    {s.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums @[30rem]:order-last @[30rem]:w-10 @[30rem]:text-right">
                    {Math.round(s.pct)}%
                  </span>
                  <span className="num shrink-0 text-sm @[30rem]:text-base">{formatMoney(s.amount, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
