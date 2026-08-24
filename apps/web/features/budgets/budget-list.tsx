"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BudgetContract } from "../../generated/api/model/budgetContract";
import {
  useDeleteBudget,
  useGetBudgetSummary,
  useListBudgets,
  useListCategories,
} from "../../generated/api";
import { Button } from "../../components/ui/button";
import { BudgetForm } from "./budget-form";
import { BudgetProgress } from "./budget-progress";
import { invalidateBudgetQueries } from "./invalidate-budget-queries";

export function BudgetList({ initialMonth = "" }: { initialMonth?: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [editing, setEditing] = useState<BudgetContract>();
  const [deleting, setDeleting] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const params = month ? { month } : undefined;
  const budgets = useListBudgets(params, { query: { retry: false } });
  const summary = useGetBudgetSummary(params, { query: { retry: false } });
  const categories = useListCategories({ query: { retry: false } });
  const remove = useDeleteBudget();
  const client = useQueryClient();
  const reportMonth =
    month.length > 0 ? month : (summary.data?.data.month ?? budgets.data?.data[0]?.month ?? "");
  const names = new Map(categories.data?.data.map((category) => [category.id, category.name]));

  async function deleteItem(item: BudgetContract) {
    setDeleteError(undefined);
    try {
      await remove.mutateAsync({ budgetId: item.id });
      await invalidateBudgetQueries(client, [item.month]);
      setDeleting(undefined);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete budget.");
    }
  }

  return (
    <section className="management-page">
      <header className="page-heading">
        <div>
          <p className="muted">Server-owned monthly limits</p>
          <h1>Budgets</h1>
        </div>
        <label className="month-picker">
          Budget month
          <input
            className="input"
            type="month"
            value={reportMonth}
            onChange={(event) => {
              setMonth(event.target.value);
              setEditing(undefined);
            }}
          />
        </label>
      </header>
      <BudgetForm
        key={editing?.id ?? `new-${reportMonth}`}
        initialMonth={reportMonth}
        budget={editing}
        onSaved={() => {
          setEditing(undefined);
        }}
      />
      {deleteError ? (
        <p role="alert" className="field-error">
          {deleteError}
        </p>
      ) : null}
      {budgets.isPending || summary.isPending ? (
        <p role="status">Loading budgets…</p>
      ) : budgets.isError || summary.isError ? (
        <div className="error-panel" role="alert">
          <p>Could not load budgets.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void budgets.refetch();
              void summary.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : summary.data.data.budgets.length > 0 ? (
        <div className="budget-grid">
          {summary.data.data.budgets.map((progress) => {
            const item = budgets.data.data.find((value) => value.id === progress.id);
            return (
              <div key={progress.id}>
                <BudgetProgress
                  budget={progress}
                  categoryName={names.get(progress.category_id) ?? "Expense category"}
                />
                {item ? (
                  <div className="card-actions">
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => {
                        setEditing(item);
                      }}
                    >
                      Edit
                    </Button>
                    {deleting === item.id ? (
                      <div className="confirm-box" role="alert">
                        <p>Delete this monthly budget?</p>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={remove.isPending}
                          onClick={() => void deleteItem(item)}
                        >
                          Confirm delete
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          onClick={() => {
                            setDeleting(undefined);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="quiet"
                        onClick={() => {
                          setDeleting(item.id);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <h2>No budgets this month</h2>
          <p>Create one above. Progress appears after server refresh.</p>
        </div>
      )}
    </section>
  );
}
