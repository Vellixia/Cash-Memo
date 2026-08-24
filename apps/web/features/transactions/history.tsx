"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import {
  useListTransactions,
  useRestoreTransaction,
  useTrashTransaction,
} from "../../generated/api";
import type { TransactionContract } from "../../generated/api/model/transactionContract";
import { TransactionFilters, readHistoryFilters } from "./filters";
import { serializeHistoryFilters } from "./history-params";
import { invalidateTransactionScopes } from "./query-keys";

export { serializeHistoryFilters } from "./history-params";

function errorText(error: unknown) {
  const value = error as { message?: string };
  return value.message ?? "Request unavailable. Try again.";
}
function isFuture(value: string) {
  return new Date(value).getTime() > Date.now();
}

export function TransactionHistory() {
  const search = useSearchParams();
  const filterKey = search.toString();
  const filters = useMemo(() => readHistoryFilters(search), [filterKey, search]);
  const [cursor, setCursor] = useState<string>();
  const [items, setItems] = useState<TransactionContract[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>();
  const [confirming, setConfirming] = useState<string>();
  const [undo, setUndo] = useState<TransactionContract>();
  const [status, setStatus] = useState<string>();
  const loadedPage = useRef<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const transactions = useListTransactions(
    { ...serializeHistoryFilters(filters), cursor, limit: "50" },
    { query: { retry: 1 } },
  );
  const trash = useTrashTransaction();
  const restore = useRestoreTransaction();

  useEffect(() => {
    setCursor(undefined);
    setItems([]);
    setNextCursor(undefined);
    loadedPage.current = undefined;
  }, [filterKey]);
  useEffect(() => {
    const page = transactions.data?.data;
    if (!page) return;
    const pageKey = `${cursor ?? "first"}:${page.items.map((item) => item.id).join(",")}:${page.next_cursor ?? ""}`;
    if (loadedPage.current === pageKey) return;
    loadedPage.current = pageKey;
    setItems((current) =>
      cursor
        ? [
            ...current,
            ...page.items.filter((item) => !current.some((known) => known.id === item.id)),
          ]
        : page.items,
    );
    setNextCursor(page.next_cursor ?? null);
  }, [cursor, transactions.data]);
  async function remove(transaction: TransactionContract) {
    try {
      await trash.mutateAsync({ transactionId: transaction.id });
      setItems((current) => current.filter((item) => item.id !== transaction.id));
      setUndo(transaction);
      setConfirming(undefined);
      setStatus("Transaction moved to Trash.");
      await invalidateTransactionScopes(queryClient, { previous: transaction });
    } catch (error) {
      setStatus(errorText(error));
    }
  }
  async function undoDelete() {
    if (!undo) return;
    try {
      await restore.mutateAsync({ transactionId: undo.id });
      await invalidateTransactionScopes(queryClient, { next: undo });
      setStatus("Transaction restored.");
      setUndo(undefined);
    } catch (error) {
      setStatus(errorText(error));
    }
  }
  if (transactions.isPending && items.length === 0)
    return <p className="loading-state">Loading transactions…</p>;
  if (transactions.isError && items.length === 0)
    return (
      <section>
        <h1>Transactions</h1>
        <p role="alert" className="field-error">
          Could not load transactions.
        </p>
        <Button type="button" onClick={() => void transactions.refetch()}>
          Retry
        </Button>
      </section>
    );
  return (
    <section className="management-page">
      <div className="page-heading">
        <div>
          <p className="muted">All manual memos</p>
          <h1>Transactions</h1>
        </div>
        <Link className="button" href="/app/transactions/new">
          New transaction
        </Link>
      </div>
      <TransactionFilters />
      {status ? (
        <p role="status" className="success">
          {status}{" "}
          {undo ? (
            <Button
              type="button"
              variant="quiet"
              onClick={() => void undoDelete()}
              disabled={restore.isPending}
            >
              Undo
            </Button>
          ) : null}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="empty-state">
          <h2>No transactions</h2>
          <p>Change filters or add your first memo.</p>
        </div>
      ) : (
        <div className="card-list">
          {items.map((transaction) => (
            <article className="management-card" key={transaction.id}>
              <div>
                <h2>
                  {transaction.direction === "income" ? "Income" : "Expense"} {transaction.amount}{" "}
                  {transaction.currency}
                </h2>
                <p className="muted">
                  {new Date(transaction.occurred_at).toLocaleString()}{" "}
                  {isFuture(transaction.occurred_at) ? <strong>Future</strong> : null}
                </p>
                <p className="muted">{transaction.note ?? "No note"}</p>
              </div>
              <div className="card-actions">
                <Link className="button quiet" href={`/app/transactions/${transaction.id}`}>
                  Edit
                </Link>
                {confirming === transaction.id ? (
                  <div className="confirm-box" role="alert">
                    <p>Move this transaction to Trash?</p>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void remove(transaction)}
                      disabled={trash.isPending}
                    >
                      Move to Trash
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
                      setConfirming(transaction.id);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {nextCursor ? (
        <Button
          type="button"
          onClick={() => {
            setCursor(nextCursor);
          }}
          disabled={transactions.isFetching}
        >
          Load more
        </Button>
      ) : null}
    </section>
  );
}
