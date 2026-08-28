"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { MoneyAmount } from "../../components/money/amount";
import {
  useGetOnboarding,
  useListTrashedTransactions,
  usePermanentlyDeleteTransaction,
  useRestoreTransaction,
} from "../../generated/api";
import type { TransactionContract } from "../../generated/api/model/transactionContract";
import { invalidateTransactionLifecycleScopes, invalidateTransactionScopes, parseCashmemoTimezone } from "./query-keys";

function errorText(error: unknown) {
  return (error as { message?: string }).message ?? "Request unavailable. Try again.";
}

function formatDate(value: string | null | undefined, timezone: string) {
  if (!value) return "server schedule unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
}

export function TransactionTrash() {
  const queryClient = useQueryClient();
  const list = useListTrashedTransactions(undefined, { query: { retry: 1 } });
  const onboarding = useGetOnboarding({ query: { retry: 1 } });
  const rawTimezone = onboarding.data?.data.timezone;
  const timezone = parseCashmemoTimezone(rawTimezone);
  const timezoneInvalid = Boolean(rawTimezone) && !timezone;
  const timezonePending = onboarding.isPending || (!rawTimezone && !onboarding.isError);
  const timezoneError = onboarding.isError || timezoneInvalid;
  const restore = useRestoreTransaction();
  const remove = usePermanentlyDeleteTransaction();
  const restoring = useRef(new Set<string>());
  const deleting = useRef(new Set<string>());
  const [pendingAction, setPendingAction] = useState<{ type: "restore" | "delete"; id: string }>();
  const [items, setItems] = useState<TransactionContract[]>();
  const transactions = items ?? list.data?.data.items ?? [];
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();

  async function retryTimezoneAndList() {
    const refreshed = await onboarding.refetch();
    if (parseCashmemoTimezone(refreshed.data?.data.timezone)) {
      await list.refetch();
    }
  }

  async function restoreItem(item: TransactionContract) {
    if (restoring.current.has(item.id)) return;
    if (!timezone) {
      setStatus({ kind: "error", text: "Cashmemo timezone is unavailable. Retry onboarding before restoring transactions." });
      return;
    }
    restoring.current.add(item.id);
    setPendingAction({ type: "restore", id: item.id });
    try {
      await restore.mutateAsync({ transactionId: item.id });
      setItems((current) => (current ?? transactions).filter((value) => value.id !== item.id));
      await invalidateTransactionScopes(queryClient, { next: item, timezone });
      setStatus({ kind: "success", text: "Transaction restored." });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    } finally {
      restoring.current.delete(item.id);
      setPendingAction(undefined);
    }
  }

  async function deleteItem(item: TransactionContract) {
    if (deleting.current.has(item.id)) return;
    deleting.current.add(item.id);
    setPendingAction({ type: "delete", id: item.id });
    try {
      await remove.mutateAsync({ transactionId: item.id });
      setItems((current) => (current ?? transactions).filter((value) => value.id !== item.id));
      await invalidateTransactionLifecycleScopes(queryClient);
      setStatus({ kind: "success", text: "Transaction permanently deleted." });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    } finally {
      deleting.current.delete(item.id);
      setPendingAction(undefined);
    }
  }

  if (!timezone && !list.data && transactions.length === 0) {
    return (
      <section>
        <h1>Trash</h1>
        {timezonePending ? <p role="status" className="muted">Loading timezone…</p> : null}
        {timezoneError ? (
          <p role="alert" className="field-error">
            Could not load timezone configuration.{" "}
            <Button type="button" onClick={() => void retryTimezoneAndList()}>Retry timezone</Button>
          </p>
        ) : null}
      </section>
    );
  }

  if (timezone && list.isPending) return <p className="loading-state">Loading Trash…</p>;
  if (timezone && list.isError)
    return (
      <section>
        <h1>Trash</h1>
        <p role="alert" className="field-error">Could not load Trash.</p>
        <Button type="button" onClick={() => void list.refetch()}>Retry</Button>
      </section>
    );

  return (
    <section className="management-page">
      <div className="page-heading">
        <div><p className="muted">Recover deleted memos before purge</p><h1>Trash</h1></div>
      </div>
      {timezonePending ? <p role="status" className="muted">Loading timezone…</p> : null}
      {timezoneError ? <p role="alert" className="field-error">Could not load timezone configuration. <Button type="button" onClick={() => void retryTimezoneAndList()}>Retry timezone</Button></p> : null}
      {status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
      {transactions.length === 0 ? (
        <div className="empty-state"><h2>Trash is empty</h2><p>Deleted memos will appear here until their scheduled purge.</p></div>
      ) : (
        <div className="card-list transaction-list">
          {transactions.map((item) => (
            <article className="transaction-row" key={item.id}>
              <div className="transaction-row-main">
                <div>
                  <p className="transaction-row-title"><span>{item.direction === "income" ? "Income" : "Expense"}</span><Badge variant="outline">Trash</Badge></p>
                  <p className="muted">{item.category_name} · {item.wallet_name}</p>
                  {timezone ? <p className="muted"><time dateTime={item.occurred_at}>{formatDate(item.occurred_at, timezone)}</time> · Deleted {formatDate(item.deleted_at, timezone)}</p> : null}
                  {timezone ? <p className="muted">Scheduled for automatic deletion after {formatDate(item.purge_after, timezone)}.</p> : null}
                </div>
                <MoneyAmount value={item.amount} currency={item.currency} direction={item.direction as "income" | "expense"} />
              </div>
              <div className="card-actions">
                <Button
                  type="button"
                  onClick={() => void restoreItem(item)}
                  disabled={!timezone || pendingAction?.id === item.id}
                  aria-disabled={!timezone || undefined}
                  aria-busy={pendingAction?.id === item.id}
                >
                  Restore
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger render={<Button type="button" variant="quiet" />}>Delete forever</AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete transaction forever?</AlertDialogTitle>
                      <AlertDialogDescription>This permanently removes this trashed memo and cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void deleteItem(item)} disabled={pendingAction?.id === item.id} aria-busy={pendingAction?.id === item.id}>Delete forever</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
