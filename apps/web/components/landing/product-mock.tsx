import { ChevronLeft, ChevronRight, Home, Plus, Tags, User } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

/** A static, faithful miniature of the app (hero net card, donut, day-grouped ledger). Pure HTML/CSS, no data. */

type Row = { emoji: string; title: string; category: string; amount: string; income?: boolean };

const DAYS: { day: string; rows: Row[] }[] = [
  {
    day: "Today",
    rows: [
      { emoji: "🍜", title: "Ramen with Sam", category: "Food", amount: "−$14.50" },
      { emoji: "🚌", title: "Monthly metro pass", category: "Transport", amount: "−$30.00" },
    ],
  },
  {
    day: "Yesterday",
    rows: [
      { emoji: "💼", title: "September salary", category: "Salary", amount: "+$3,200.00", income: true },
      { emoji: "☕", title: "Flat white in Lisbon", category: "Coffee", amount: "−€3.80" },
      { emoji: "🛍️", title: "Souvenirs, Tokyo", category: "Shopping", amount: "−¥1,200" },
    ],
  },
  {
    day: "Mon 21 Sep",
    rows: [
      { emoji: "🧾", title: "Internet bill", category: "Bills", amount: "−$45.00" },
      { emoji: "🎨", title: "Logo for a friend", category: "Side work", amount: "+$250.00", income: true },
    ],
  },
];

const SLICES = [
  { emoji: "🍜", name: "Food", pct: 34, color: "var(--cat-1)" },
  { emoji: "🧾", name: "Bills", pct: 26, color: "var(--cat-2)" },
  { emoji: "🚌", name: "Transport", pct: 16, color: "var(--cat-4)" },
  { emoji: "🛍️", name: "Shopping", pct: 14, color: "var(--cat-5)" },
  { emoji: "🎉", name: "Fun", pct: 10, color: "var(--cat-6)" },
];

const panel = "rounded-2xl border border-border bg-card shadow-paper";

function NetCard({ className }: { className?: string }) {
  return (
    <div className={cn(panel, "p-3.5", className)}>
      <p className="text-[0.65rem] font-medium text-muted-foreground">Net this month</p>
      <p className="num mt-0.5 text-[1.9rem] leading-none text-income">+$1,862.40</p>
      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-[68%] bg-income" />
        <div className="h-full w-0.5 bg-card" />
        <div className="h-full flex-1 bg-expense" />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-[0.58rem] text-muted-foreground">
        <div>
          <dt className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-income" /> Income
          </dt>
          <dd className="num text-[0.8rem] text-foreground">$3,450.00</dd>
        </div>
        <div className="text-right">
          <dt className="flex items-center justify-end gap-1">
            <span className="size-1.5 rounded-full bg-expense" /> Expense
          </dt>
          <dd className="num text-[0.8rem] text-foreground">$1,587.60</dd>
        </div>
      </dl>
    </div>
  );
}

const STOPS = SLICES.map((s, i) => {
  const from = SLICES.slice(0, i).reduce((sum, x) => sum + x.pct, 0);
  return `${s.color} ${from}% ${from + s.pct}%`;
}).join(", ");

function Donut() {
  return (
    <div className={cn(panel, "flex items-center gap-4 p-3.5")}>
      <div className="relative size-20 shrink-0 rounded-full" style={{ background: `conic-gradient(${STOPS})` }}>
        <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-card">
          <span className="text-[0.5rem] text-muted-foreground">Spent</span>
          <span className="num text-[0.7rem]">$1,587</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-[0.62rem]">
        {SLICES.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="truncate">
              {s.emoji} {s.name}
            </span>
            <span className="num ml-auto text-muted-foreground">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ledger({ limit }: { limit: number }) {
  const offsets = DAYS.map((_, i) => DAYS.slice(0, i).reduce((n, d) => n + d.rows.length, 0));
  return (
    <div className="space-y-2.5">
      {DAYS.map(({ day, rows }, i) => {
        const shown = rows.slice(0, Math.max(0, limit - offsets[i]));
        if (!shown.length) return null;
        return (
          <div key={day}>
            <p className="px-1 pb-1 text-[0.6rem] font-medium tracking-wide text-muted-foreground uppercase">{day}</p>
            <ul className={cn(panel, "divide-y divide-border px-2.5")}>
              {shown.map((r) => (
                <li key={r.title} className="flex items-center gap-2.5 py-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm">{r.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.7rem] font-medium">{r.title}</span>
                    <span className="block text-[0.58rem] text-muted-foreground">{r.category}</span>
                  </span>
                  <span className={cn("num shrink-0 text-[0.75rem]", r.income ? "text-income" : "text-expense")}>{r.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function PhoneMock({ className }: { className?: string }) {
  return (
    <div className={cn("w-[264px] rounded-[2.4rem] border border-border bg-card p-2 shadow-[0_30px_60px_-25px_rgb(28_27_25/0.35)]", className)}>
      <div className="relative flex h-[500px] flex-col overflow-hidden rounded-[1.95rem] bg-background">
        <div className="mx-auto mt-2 h-4 w-20 rounded-full bg-neutral-900 dark:bg-black" />
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <ChevronLeft className="size-3.5 text-muted-foreground" />
          <span className="font-serif text-sm">September 2026</span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </div>
        <div className="space-y-2.5 px-3">
          <NetCard />
          <Ledger limit={4} />
        </div>
        <div className="mt-auto flex items-center justify-around border-t border-border bg-card/90 px-3 pt-2 pb-3 text-[0.55rem] text-muted-foreground">
          <span className="flex flex-col items-center gap-0.5 text-income">
            <Home className="size-3.5" /> Home
          </span>
          <span className="-mt-5 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-paper">
            <Plus className="size-4" />
          </span>
          <span className="flex flex-col items-center gap-0.5">
            <Tags className="size-3.5" /> Categories
          </span>
        </div>
      </div>
    </div>
  );
}

function DesktopMock({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-background shadow-[0_40px_80px_-40px_rgb(28_27_25/0.35)]", className)}>
      <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-2">
        <span className="size-2 rounded-full bg-border" />
        <span className="size-2 rounded-full bg-border" />
        <span className="size-2 rounded-full bg-border" />
        <span className="mx-auto rounded-md bg-muted px-6 py-0.5 text-[0.55rem] text-muted-foreground">cashmemo.andresholivin.dev</span>
      </div>
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Logo size={16} />
        <span className="font-serif text-xs">Cash Memo</span>
        <span className="ml-2 rounded-md bg-muted px-2 py-0.5 text-[0.6rem] font-medium">Home</span>
        <span className="text-[0.6rem] text-muted-foreground">Categories</span>
        <span className="ml-auto rounded-md bg-primary px-2 py-1 text-[0.6rem] font-medium text-primary-foreground">+ New memo</span>
        <User className="size-3.5 text-muted-foreground" />
      </div>
      {/* Ledger on the left (the phone overlaps it and shows the same rows); net + donut stay in view. */}
      <div className="grid grid-cols-[1.2fr_1fr] gap-3 p-4">
        <div className="pt-8">
          <Ledger limit={6} />
        </div>
        <div className="space-y-3">
          <p className="text-right font-serif text-base">September 2026</p>
          <NetCard />
          <Donut />
        </div>
      </div>
    </div>
  );
}

export function ProductMock() {
  return (
    <div
      role="img"
      aria-label="Cash Memo on a phone and a laptop: a net of +$1,862.40 for September, a spending donut, and memos grouped by day in dollars, euros and yen."
      className="relative mx-auto w-full max-w-[640px] md:pb-14"
    >
      <DesktopMock className="hidden md:ml-auto md:block md:w-[86%] lg:w-[90%]" />
      <PhoneMock className="mx-auto md:absolute md:bottom-0 md:-left-2 md:-rotate-6 lg:-left-6" />
    </div>
  );
}
