"use client";

import { useState } from "react";
import { useGetBudgetSummary, useGetMonthlySummary, useGetRecentTransactions } from "../../generated/api";
import { Amount } from "../../components/money/amount";
import { MonthlySummary } from "./monthly-summary";
import { RecentTransactions } from "./recent-transactions";

function QueryError({ children, retry }: { children: string; retry: () => unknown }) {
  return <div className="error-panel" role="alert"><p>{children}</p><button className="button button-secondary" type="button" onClick={() => void retry()}>Retry</button></div>;
}

export function Dashboard({ initialMonth = "" }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth);
  const params = month ? { month } : undefined;
  const monthly = useGetMonthlySummary(params, { query: { retry: false } });
  const budgets = useGetBudgetSummary(params, { query: { retry: false } });
  const recent = useGetRecentTransactions({ query: { retry: false } });
  const reportMonth = month.length > 0 ? month : (monthly.data?.data.month ?? budgets.data?.data.month ?? "");

  return <section className="management-page"><header className="page-heading"><div><p className="muted">Private money journal</p><h1>Overview</h1></div><label className="month-picker">Reporting month<input className="input" type="month" value={reportMonth} onChange={event => { setMonth(event.target.value); }} /></label></header><section aria-labelledby="monthly-heading"><h2 id="monthly-heading" className="section-heading">Monthly summary</h2>{monthly.isPending ? <p role="status">Loading monthly summary…</p> : monthly.isError ? <QueryError retry={monthly.refetch}>Could not load monthly summary.</QueryError> : <MonthlySummary summary={monthly.data.data} />}</section><section aria-labelledby="budget-heading"><div className="section-heading-row"><h2 id="budget-heading">Budget snapshot</h2><a href="/app/budgets">Manage budgets</a></div>{budgets.isPending ? <p role="status">Loading budget summary…</p> : budgets.isError ? <QueryError retry={budgets.refetch}>Could not load budget summary.</QueryError> : budgets.data.data.budgets.length > 0 ? <div className="card-list">{budgets.data.data.budgets.map(budget => <article className="management-card" key={budget.id}><div><h3>Category budget</h3><p>{budget.progress}% used</p></div><p><Amount currency={budget.currency} value={budget.spent} /> of <Amount currency={budget.currency} value={budget.budgeted} /></p></article>)}</div> : <p className="muted">No budgets for this month.</p>}</section><section aria-labelledby="recent-heading"><h2 id="recent-heading">Recent transactions</h2>{recent.isPending ? <p role="status">Loading recent transactions…</p> : recent.isError ? <QueryError retry={recent.refetch}>Could not load recent transactions.</QueryError> : <RecentTransactions recent={recent.data.data} />}</section></section>;
}
