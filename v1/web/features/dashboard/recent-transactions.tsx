import type { RecentTransactionsContract } from "../../generated/api/model/recentTransactionsContract";
import { Amount } from "../../components/money/amount";

export function RecentTransactions({ recent }: { recent: RecentTransactionsContract }) {
  if (recent.items.length === 0) return <div className="empty-state"><h2>No recent transactions</h2></div>;
  return <div className="card-list">{recent.items.map(transaction => { const title = transaction.note?.trim() ?? (transaction.direction === "income" ? "Income" : "Expense"); return <article className="management-card" key={transaction.id}><div><h3>{title}</h3><p className="muted">{new Date(transaction.occurred_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</p></div><p><span className="status-label">{transaction.direction === "income" ? "Income" : "Expense"}</span> <Amount currency={transaction.currency} value={transaction.amount} /></p></article>; })}</div>;
}
