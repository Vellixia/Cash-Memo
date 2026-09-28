/** Credit/paylater due & statement date math: a day-of-month rolled forward to its next
 * occurrence, clamped to the month's last day (e.g. day 31 in February -> the 28th/29th). */

/** The next date `day` falls on at/after `from`'s calendar day (today counts, doesn't roll over). */
export function nextOccurrence(day: number, from = new Date()): Date {
  const clamp = (y: number, m: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const thisMonth = clamp(from.getFullYear(), from.getMonth());
  return thisMonth >= today ? thisMonth : clamp(from.getFullYear(), from.getMonth() + 1);
}

/** Whole calendar days from `from` to `date` (today -> 0, tomorrow -> 1). */
export function daysUntil(date: Date, from = new Date()): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "Sep 30" — fixed locale so it reads the same everywhere. */
export function shortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
