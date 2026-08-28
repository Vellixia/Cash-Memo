"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecurringTransaction } from "../../generated/api/model/recurringTransaction";
import {
  getListRecurringTransactionsQueryKey,
  useDeleteRecurringTransaction,
  useListRecurringTransactions,
  usePauseRecurringTransaction,
  useResumeRecurringTransaction,
} from "../../generated/api";
import { MoneyAmount } from "../../components/money/amount";
import { Badge } from "../../components/ui/badge";
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
import { useListCategories, useListWallets } from "../../generated/api";
import { RecurringForm } from "./recurring-form";

export function RecurringList() {
  const query = useListRecurringTransactions({ query: { retry: false } });
  const wallets = useListWallets({ query: { retry: false } });
  const categories = useListCategories({ query: { retry: false } });
  const pause = usePauseRecurringTransaction();
  const resume = useResumeRecurringTransaction();
  const remove = useDeleteRecurringTransaction();
  const client = useQueryClient();
  const [editing, setEditing] = useState<RecurringTransaction>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();

  function formatLocalDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;
    const [, year, month, day] = match;
    const monthName = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][Number(month) - 1];
    return monthName ? `${monthName} ${String(Number(day))}, ${year}` : value;
  }

  async function refresh(message: string) {
    await client.invalidateQueries({ queryKey: getListRecurringTransactionsQueryKey() });
    setStatus({ kind: "success", text: message });
  }
  async function toggle(item: RecurringTransaction) {
    setStatus(undefined);
    try {
      if (item.status === "paused") await resume.mutateAsync({ id: item.id });
      else await pause.mutateAsync({ id: item.id });
      await refresh(
        item.status === "paused"
          ? "Recurring rule resumed. First cadence date on or after resume; no backfill."
          : "Recurring rule paused. No occurrences during paused period.",
      );
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not update recurring rule.",
      });
    }
  }
  async function deleteItem(id: string) {
    setStatus(undefined);
    try {
      await remove.mutateAsync({ id });
      await refresh("Recurring rule deleted.");
      setDeleting(undefined);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not delete recurring rule.",
      });
    }
  }

  if (query.isPending) return <p role="status">Loading recurring rules…</p>;
  if (query.isError)
    return (
      <div className="error-panel" role="alert">
        <p>Could not load recurring rules.</p>
        <Button type="button" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  const items = query.data.data;
  const walletNames = new Map(wallets.data?.data.map((item) => [item.id, item.name]));
  const categoryNames = new Map(categories.data?.data.map((item) => [item.id, item.name]));
  return (
    <section className="management-page">
      <header className="page-heading">
        <div>
          <p className="muted">Scheduled instructions</p>
          <h1>Recurring transactions</h1>
        </div>
        <Button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditing(undefined);
          }}
        >
          New recurring rule
        </Button>
      </header>
      <p className="notice">
        An upcoming recurring rule does not affect totals or history until Cashmemo generates a
        transaction on its due date.
      </p>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="management-dialog">
          <DialogHeader>
            <DialogTitle>New recurring rule</DialogTitle>
            <DialogDescription>
              Cashmemo schedules future occurrences from this instruction.
            </DialogDescription>
          </DialogHeader>
          <RecurringForm
            embedded
            onSaved={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="management-dialog">
          <DialogHeader>
            <DialogTitle>Edit recurring rule</DialogTitle>
            <DialogDescription>
              Changes apply to future scheduled occurrences only.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <RecurringForm
              key={editing.id}
              recurring={editing}
              embedded
              onSaved={() => setEditing(undefined)}
              onCancel={() => setEditing(undefined)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {status ? (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={status.kind === "error" ? "field-error" : "success"}
        >
          {status.text}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="empty-state">
          <h2>No recurring rules</h2>
          <p>Create a daily, weekly, monthly, or yearly instruction.</p>
        </div>
      ) : (
        <div className="card-list">
          {items.map((item) => {
            const title = item.note?.trim() ?? `${item.frequency} ${item.direction}`;
            return (
              <article className="management-card" key={item.id}>
                <div>
                  <h2>{title}</h2>
                  <p>
                    <Badge variant={item.status === "paused" ? "outline" : "secondary"}>
                      <span aria-hidden="true">{item.status === "paused" ? "⏸" : "●"}</span>{" "}
                      {item.status === "paused" ? "Paused" : "Active"}
                    </Badge>{" "}
                    · {item.frequency}
                  </p>
                  <p>
                    <MoneyAmount
                      currency={item.currency}
                      value={item.amount}
                      direction={item.direction}
                    />{" "}
                    · {item.direction === "income" ? "↑ Income" : "↓ Expense"}
                    <span className="muted">
                      · Wallet: {walletNames.get(item.wallet_id) ?? "Wallet"} · Category:{" "}
                      {categoryNames.get(item.category_id) ?? "Category"}
                    </span>
                  </p>
                  <p className="muted">Next due: {formatLocalDate(item.next_due_date)}</p>
                </div>
                <div className="card-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      setEditing(item);
                      setCreating(false);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pause.isPending || resume.isPending}
                    onClick={() => void toggle(item)}
                  >
                    {item.status === "paused" ? "Resume" : "Pause"}
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
              </article>
            );
          })}
        </div>
      )}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recurring rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete only future scheduling instructions. Generated transactions and history stay
              unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={() => deleting && void deleteItem(deleting)}
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
