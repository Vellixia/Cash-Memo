export interface HistoryRequestFilters {
  from?: string;
  to?: string;
  type?: string;
  wallet?: string;
  category?: string;
  q?: string;
}

function semanticDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    return undefined;
  return value;
}

export function serializeHistoryFilters(filters: HistoryRequestFilters) {
  const from = semanticDate(filters.from);
  const to = semanticDate(filters.to);
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.wallet ? { wallet_id: filters.wallet } : {}),
    ...(filters.category ? { category_id: filters.category } : {}),
  };
}

export function historyMonthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return serializeHistoryFilters({
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  });
}
