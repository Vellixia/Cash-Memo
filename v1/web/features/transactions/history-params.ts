export interface HistoryRequestFilters {
  from?: string;
  to?: string;
  type?: string;
  wallet?: string;
  category?: string;
  q?: string;
}

function rfc3339Boundary(value: string | undefined, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    return undefined;
  return `${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;
}

export function serializeHistoryFilters(filters: HistoryRequestFilters) {
  const from = rfc3339Boundary(filters.from);
  const to = rfc3339Boundary(filters.to, true);
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.wallet ? { wallet_id: filters.wallet } : {}),
    ...(filters.category ? { category_id: filters.category } : {}),
    ...(filters.q ? { q: filters.q } : {}),
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
