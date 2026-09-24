import { formatMoney, type SummaryTotal } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

/** Per-currency Income / Expense / Net cards. */
export function SummaryCards({ totals }: { totals: SummaryTotal[] }) {
  const byCurrency = new Map<string, { income: number; expense: number }>();
  for (const t of totals) {
    const entry = byCurrency.get(t.currency) ?? { income: 0, expense: 0 };
    entry[t.direction] = t.total_minor;
    byCurrency.set(t.currency, entry);
  }

  if (byCurrency.size === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[...byCurrency.entries()].map(([currency, { income, expense }]) => (
        <Card key={currency}>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{currency}</p>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Income</dt>
                <dd className="tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{formatMoney(income, currency)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Expense</dt>
                <dd className="tabular-nums text-rose-600 dark:text-rose-400">
                  &minus;{formatMoney(expense, currency)}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-1.5 font-medium">
                <dt>Net</dt>
                <dd
                  className={`tabular-nums ${
                    income - expense >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {income - expense >= 0 ? "+" : "−"}
                  {formatMoney(Math.abs(income - expense), currency)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
