import { formatMoney, type Category, type CategoryTotal } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TOP_N = 6;

/** Horizontal bars for the top expense categories of the month, per currency. */
export function CategoryBars({
  byCategory,
  categories,
}: {
  byCategory: CategoryTotal[];
  categories: Category[];
}) {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const currencies = [...new Set(byCategory.filter((c) => c.direction === "expense").map((c) => c.currency))];

  if (currencies.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by category</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {currencies.map((currency) => {
          const rows = byCategory
            .filter((c) => c.direction === "expense" && c.currency === currency)
            .sort((a, b) => b.total_minor - a.total_minor)
            .slice(0, TOP_N);
          const max = rows[0]?.total_minor ?? 1;

          return (
            <div key={currency} className="space-y-2.5">
              {currencies.length > 1 && <p className="text-xs font-medium text-muted-foreground">{currency}</p>}
              {rows.map((row) => {
                const label = row.category_id ? (nameById.get(row.category_id) ?? "Unknown") : "Uncategorized";
                return (
                  <div key={`${row.category_id}-${currency}`} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate text-foreground">{label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatMoney(row.total_minor, currency)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-rose-500/70"
                        style={{ width: `${Math.max(4, (row.total_minor / max) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
