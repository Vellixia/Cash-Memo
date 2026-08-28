"use client";

import { useEffect, useState } from "react";
import {
  useGetBudgetSummary,
  useGetMonthlySummary,
  useGetRecentTransactions,
} from "../../generated/api";
import type { BudgetProgressContract } from "../../generated/api/model/budgetProgressContract";
import { CurrencyGroup } from "../../components/money/currency-group";
import { Skeleton } from "../../components/ui/skeleton";
import { BudgetProgress } from "../budgets/budget-progress";
import { MonthlySummary } from "./monthly-summary";
import { RecentTransactions } from "./recent-transactions";

function QueryError({ children, retry }: { children: string; retry: () => unknown }) {
  return (
    <div className="error-panel" role="alert">
      <p>{children}</p>
      <button className="button secondary" type="button" onClick={() => void retry()}>
        Retry
      </button>
    </div>
  );
}

export function Dashboard({ initialMonth = "" }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth);
  const params = month ? { month } : undefined;
  const monthly = useGetMonthlySummary(params, { query: { retry: false } });
  const budgets = useGetBudgetSummary(params, { query: { retry: false } });
  const recent = useGetRecentTransactions(params, { query: { retry: false } });
  useEffect(() => {
    if (!initialMonth && typeof window !== "undefined") {
      const urlMonth = new URLSearchParams(window.location.search).get("month") ?? "";
      if (/^\d{4}-\d{2}$/.test(urlMonth)) setMonth(urlMonth);
    }
  }, [initialMonth]);
  const reportMonth =
    month.length > 0 ? month : (monthly.data?.data.month ?? budgets.data?.data.month ?? "");
  const budgetsByCurrency: Record<string, BudgetProgressContract[]> = {};
  budgets.data?.data.budgets.forEach((budget) => {
    (budgetsByCurrency[budget.currency] ??= []).push(budget);
  });

  return (
    <section className="management-page">
      <header className="page-heading">
        <div>
          <p className="muted">Private money journal</p>
          <h1>Overview</h1>
        </div>
        <label className="month-picker">
          Reporting month
          <input
            className="input"
            type="month"
            value={reportMonth}
            onChange={(event) => {
              const nextMonth = event.target.value;
              setMonth(nextMonth);
              if (typeof window !== "undefined") {
                const url = new URL(window.location.href);
                if (nextMonth) url.searchParams.set("month", nextMonth);
                else url.searchParams.delete("month");
                window.history.replaceState({}, "", url);
              }
            }}
          />
        </label>
      </header>

      <section aria-labelledby="monthly-heading">
        <h2 id="monthly-heading" className="section-heading">
          Monthly summary
        </h2>
        {monthly.isPending ? (
          <div className="currency-grid" role="status" aria-label="Loading monthly summary">
            <Skeleton className="dashboard-skeleton dashboard-skeleton-summary" />
            <Skeleton className="dashboard-skeleton dashboard-skeleton-summary" />
          </div>
        ) : monthly.isError ? (
          <QueryError retry={monthly.refetch}>Could not load monthly summary.</QueryError>
        ) : (
          <MonthlySummary summary={monthly.data.data} />
        )}
      </section>

      <section aria-labelledby="budget-heading">
        <div className="section-heading-row">
          <h2 id="budget-heading">Budget snapshot</h2>
          <a href="/app/budgets">Manage budgets</a>
        </div>
        {budgets.isPending ? (
          <Skeleton
            className="dashboard-skeleton dashboard-skeleton-budget"
            role="status"
            aria-label="Loading budget summary"
          />
        ) : budgets.isError ? (
          <QueryError retry={budgets.refetch}>Could not load budget summary.</QueryError>
        ) : budgets.data.data.budgets.length > 0 ? (
          <div className="currency-grid">
            {Object.entries(budgetsByCurrency).map(([currency, items]) => (
              <CurrencyGroup key={currency} currency={currency} idPrefix="budget-currency">
                <div className="card-list">
                  {items.map((budget) => (
                    <BudgetProgress
                      key={budget.id}
                      budget={budget}
                      categoryName="Category budget"
                    />
                  ))}
                </div>
              </CurrencyGroup>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>No budgets this month</h3>
            <p className="muted">Create a budget to track category limits.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading">Recent transactions</h2>
        {recent.isPending ? (
          <Skeleton
            className="dashboard-skeleton dashboard-skeleton-recent"
            role="status"
            aria-label="Loading recent transactions"
          />
        ) : recent.isError ? (
          <QueryError retry={recent.refetch}>Could not load recent transactions.</QueryError>
        ) : (
          <RecentTransactions recent={recent.data.data} />
        )}
      </section>
    </section>
  );
}
