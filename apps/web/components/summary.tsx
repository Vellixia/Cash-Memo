"use client";

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
  if (!summary) return <Skeleton className="h-52 rounded-3xl" />;
  const total = (direction: string) =>
    summary.totals.find((t) => t.currency === currency && t.direction === direction)?.total_minor ?? 0;
  const income = total("income");
  const expense = total("expense");
  const net = income - expense;
  const sum = income + expense;
  const incomeShare = sum ? (income / sum) * 100 : 50;

  return (
    <section className={cn(card, "relative overflow-hidden p-5 md:p-7")} aria-label="This month">
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
        className={cn("num mt-2 text-5xl leading-none md:text-6xl", net > 0 && "text-income", net < 0 && "text-expense")}
      >
        {signedMoney(net, currency)}
      </p>

      <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        {sum > 0 && (
          <>
            <div className="h-full bg-income transition-[width] duration-500" style={{ width: `${incomeShare}%` }} />
            <div className="h-full w-0.5 shrink-0 bg-card" />
            <div className="h-full flex-1 bg-expense" />
          </>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-income" /> Income
          </dt>
          <dd data-testid="hero-income" className="num mt-1 text-2xl text-foreground">
            {formatMoney(income, currency)}
          </dd>
        </div>
        <div className="text-right">
          <dt className="flex items-center justify-end gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-expense" /> Expense
          </dt>
          <dd data-testid="hero-expense" className="num mt-1 text-2xl text-foreground">
            {formatMoney(expense, currency)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function SpendingCard({
  summary,
  currency,
  categories,
}: {
  summary: Summary | undefined;
  currency: string;
  categories: Category[];
}) {
  if (!summary) return <Skeleton className="h-56 rounded-3xl" />;
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

  return (
    <section className={cn(card, "p-5 md:p-7")} aria-labelledby="spending-title">
      <h2 id="spending-title" className="font-serif text-xl">
        Spending by category
      </h2>
      {slices.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No expenses in {currency} this month yet.</p>
      ) : (
        <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="relative size-40 shrink-0 rounded-full" style={{ background: gradient }} role="img" aria-label="Spending donut chart">
            <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-card text-center">
              <span className="text-[0.7rem] font-medium text-muted-foreground">Spent</span>
              <span className="num text-lg leading-tight">{formatMoney(total, currency)}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 flex-1 divide-y divide-border/70" data-testid="donut-legend">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-3 py-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
                <span className="w-5 shrink-0 text-center" aria-hidden>
                  {s.emoji ?? ""}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="num shrink-0 text-base">{formatMoney(s.amount, currency)}</span>
                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{Math.round(s.pct)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
