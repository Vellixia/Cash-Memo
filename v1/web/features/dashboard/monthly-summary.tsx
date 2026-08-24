import type { MonthlySummaryContract } from "../../generated/api/model/monthlySummaryContract";
import { Amount } from "../../components/money/amount";
import { CurrencyGroup } from "../../components/money/currency-group";

export function MonthlySummary({ summary }: { summary: MonthlySummaryContract }) {
  if (summary.currencies.length === 0) return <div className="empty-state"><h2>No activity this month</h2><p>Confirmed transactions will appear here.</p></div>;
  return <div className="currency-grid">{summary.currencies.map(group => <CurrencyGroup key={group.currency} currency={group.currency}><dl className="summary-grid"><div><dt>Income</dt><dd><Amount currency={group.currency} value={group.income} /></dd></div><div><dt>Expense</dt><dd><Amount currency={group.currency} value={group.expense} /></dd></div><div><dt>Net</dt><dd><Amount currency={group.currency} value={group.net} /></dd></div></dl>{group.expense_categories.length > 0 ? <div><h3>Expense categories</h3><ul className="plain-list">{group.expense_categories.map(category => <li key={category.category_id}><span>{category.name}</span><Amount currency={group.currency} value={category.expense} /></li>)}</ul></div> : <p className="muted">No expenses in this currency.</p>}</CurrencyGroup>)}</div>;
}
