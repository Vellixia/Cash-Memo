"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import {
  useListTrashedTransactions,
  usePermanentlyDeleteTransaction,
  useRestoreTransaction,
} from "../../generated/api";
import type { TransactionContract } from "../../generated/api/model/transactionContract";
import { invalidateTransactionScopes } from "./query-keys";

function errorText(error: unknown) {
  const value = error as { message?: string };
  return value.message ?? "Request unavailable. Try again.";
}

export function TransactionTrash() {
  const queryClient = useQueryClient();
  const list = useListTrashedTransactions(undefined, { query: { retry: 1 } });
  const restore = useRestoreTransaction();
  const remove = usePermanentlyDeleteTransaction();
  const [confirming, setConfirming] = useState<string>();
  const [items, setItems] = useState<TransactionContract[] | undefined>();
  const transactions = items ?? list.data?.data.items ?? [];
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  async function restoreItem(item: TransactionContract) {
    try {
      await restore.mutateAsync({ transactionId: item.id });
      setItems((current) => (current ?? transactions).filter((value) => value.id !== item.id));
      await invalidateTransactionScopes(queryClient, { next: item });
      setStatus({ kind: "success", text: "Transaction restored." });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }
  async function deleteItem(item: TransactionContract) {
    try {
      await remove.mutateAsync({ transactionId: item.id });
      setItems((current) => (current ?? transactions).filter((value) => value.id !== item.id));
      setConfirming(undefined);
      await invalidateTransactionScopes(queryClient, { previous: item });
      setStatus({ kind: "success", text: "Transaction permanently deleted." });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }
  if (list.isPending) return <p className="loading-state">Loading Trash…</p>;
  if (list.isError)
    return (
      <section>
        <h1>Trash</h1>
        <p role="alert" className="field-error">
          Could not load Trash.
        </p>
        <Button type="button" onClick={() => void list.refetch()}>
          Retry
        </Button>
      </section>
    );
  return (
    <section className="management-page">
      <div className="page-heading">
        <div>
          <p className="muted">Recover deleted memos before purge</p>
          <h1>Trash</h1>
        </div>
      </div>
      {status ? (
        <p
          role={status.kind === "error" ? "alert" : "status"}
          className={status.kind === "error" ? "field-error" : "success"}
        >
          {status.text}
        </p>
      ) : null}
      {transactions.length === 0 ? (
        <div className="empty-state">
          <h2>Trash is empty</h2>
        </div>
      ) : (
        <div className="card-list">
          {transactions.map((item) => (
            <article className="management-card" key={item.id}>
              <div>
                <h2>
                  {item.direction} {item.amount} {item.currency}
                </h2>
                <p className="muted">
                  Purge after{" "}
                  {item.purge_after
                    ? new Date(item.purge_after).toLocaleDateString()
                    : "server schedule unavailable"}
                </p>
              </div>
              <div className="card-actions">
                <Button
                  type="button"
                  onClick={() => void restoreItem(item)}
                  disabled={restore.isPending}
                >
                  Restore
                </Button>
                {confirming === item.id ? (
                  <div className="confirm-box" role="alert">
                    <p>Permanently delete this transaction? This cannot be undone.</p>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void deleteItem(item)}
                      disabled={remove.isPending}
                    >
                      Confirm permanent delete
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => {
                        setConfirming(undefined);
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
                      setConfirming(item.id);
                    }}
                  >
                    Delete forever
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
