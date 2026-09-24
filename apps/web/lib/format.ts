import type { Memo } from "@/lib/api";

const pad = (n: number) => String(n).padStart(2, "0");

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "2026-09" -> "September 2026". Fixed locale so server and client render the same text. */
export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: style, year: "numeric" });
}

export function toDatetimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local calendar day, "YYYY-MM-DD". */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayLabel(key: string, now = new Date()): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(yesterday)) return "Yesterday";
  // "Mon 21 Sep" (en-GB would say "Sept")
  const part = (o: Intl.DateTimeFormatOptions) => date.toLocaleDateString("en-US", o);
  return `${part({ weekday: "short" })} ${date.getDate()} ${part({ month: "short" })}`;
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function signedAmount(memo: Pick<Memo, "direction" | "amount_minor">): number {
  return memo.direction === "income" ? memo.amount_minor : -memo.amount_minor;
}

export type DayGroup = { key: string; memos: Memo[]; net: Record<string, number> };

/** Groups memos (already newest-first) by local day, keeping order; `net` is per currency. */
export function groupByDay(memos: Memo[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const memo of memos) {
    const key = dayKey(new Date(memo.occurred_at));
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, memos: [], net: {} };
      groups.push(g);
    }
    g.memos.push(memo);
    g.net[memo.currency] = (g.net[memo.currency] ?? 0) + signedAmount(memo);
  }
  return groups;
}

/** Harmonious category palette (CSS vars defined in globals.css for light + dark). */
export const CATEGORY_COLORS = Array.from({ length: 8 }, (_, i) => `var(--cat-${i + 1})`);

/** First user-perceived character, so "🛍️" or a flag stays whole. */
export function firstGrapheme(value: string): string {
  const s = value.trim();
  if (!s) return "";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const [first] = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s);
    return first?.segment ?? "";
  }
  return [...s].slice(0, 2).join("");
}
