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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
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
      {!editing ? (
        <BudgetForm
          key={`new-${reportMonth}`}
          initialMonth={reportMonth}
          onSaved={() => {
            setEditing(undefined);
          }}
        />
      ) : null}
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
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => {
                        setDeleting(item.id);
                      }}
                    >
                      Delete
                    </Button>
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
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="management-dialog">
          <DialogHeader>
            <DialogTitle>Edit budget</DialogTitle>
            <DialogDescription>Changes refresh totals from Cashmemo after save.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <BudgetForm
              key={editing.id}
              budget={editing}
              embedded
              onSaved={() => setEditing(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(undefined);
            setDeleteError(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete monthly budget?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes only budget target and keeps transactions and history unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={() => {
                const item = budgets.data?.data.find((value) => value.id === deleting);
                if (item) void deleteItem(item);
              }}
              disabled={remove.isPending}
              aria-busy={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Confirm delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
