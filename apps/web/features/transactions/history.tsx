"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { MoneyAmount } from "../../components/money/amount";
import {
  useGetOnboarding,
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
  return (error as { message?: string }).message ?? "Request unavailable. Try again.";
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function isFuture(value: string) {
  return new Date(value).getTime() > Date.now();
}

function TransactionRow({
  transaction,
  timezone,
  onTrash,
}: {
  transaction: TransactionContract;
  timezone: string;
  onTrash: (transaction: TransactionContract) => void;
}) {
  const direction = transaction.direction === "income" ? "Income" : "Expense";
  const context = `${direction}, ${transaction.wallet_name}, ${transaction.category_name}`;
  return (
    <article className="transaction-row" aria-label={context}>
      <Link className="transaction-row-main" href={`/app/transactions/${transaction.id}/edit`}>
        <div>
          <p className="transaction-row-title">
            <span>{direction}</span>
            {isFuture(transaction.occurred_at) ? <Badge variant="outline">Future</Badge> : null}
          </p>
          <p className="muted">{transaction.category_name} · {transaction.wallet_name}</p>
          <p className="muted">{transaction.note ?? "No note"}</p>
        </div>
        <div className="transaction-row-value">
          <MoneyAmount value={transaction.amount} currency={transaction.currency} direction={transaction.direction as "income" | "expense"} context={context} />
          <time dateTime={transaction.occurred_at}>{formatDate(transaction.occurred_at, timezone)}</time>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="quiet" aria-label={`Actions for ${transaction.note ?? direction}`} />}>
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<Link href={`/app/transactions/${transaction.id}/edit`} />}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onTrash(transaction)}>Move to Trash</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}

export function TransactionHistory() {
  const search = useSearchParams();
  const filterKey = search.toString();
  const filters = useMemo(() => readHistoryFilters(search), [filterKey, search]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [items, setItems] = useState<TransactionContract[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>();
  const [failedCursor, setFailedCursor] = useState<string>();
  const [undo, setUndo] = useState<TransactionContract>();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const loadedPage = useRef<string | undefined>(undefined);
  const restoring = useRef(false);
  const queryClient = useQueryClient();
  const onboarding = useGetOnboarding({ query: { retry: 1 } });
  const timezone = onboarding.data?.data.timezone ?? "UTC";
  const transactions = useListTransactions(
    { ...serializeHistoryFilters(filters), q: query || undefined, cursor, limit: "50" },
    { query: { retry: 1 } },
  );
  const trash = useTrashTransaction();
  const restore = useRestoreTransaction();

  useEffect(() => {
    setCursor(undefined);
    setItems([]);
    setNextCursor(undefined);
    setFailedCursor(undefined);
    loadedPage.current = undefined;
  }, [filterKey, query]);

  useEffect(() => {
    if (!transactions.isError || cursor === undefined) return;
    setFailedCursor(cursor);
  }, [cursor, transactions.isError]);

  useEffect(() => {
    const page = transactions.data?.data;
    if (!page) return;
    const pageKey = `${cursor ?? "first"}:${page.items.map((item) => item.id).join(",")}:${page.next_cursor ?? ""}`;
    if (loadedPage.current === pageKey) return;
    loadedPage.current = pageKey;
    setFailedCursor(undefined);
    setItems((current) =>
      cursor ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))] : page.items,
    );
    setNextCursor(page.next_cursor ?? null);
  }, [cursor, transactions.data]);

  async function remove(transaction: TransactionContract) {
    try {
      await trash.mutateAsync({ transactionId: transaction.id });
      setItems((current) => current.filter((item) => item.id !== transaction.id));
      setUndo(transaction);
      setStatus({ kind: "success", text: "Transaction moved to Trash." });
      toast("Transaction moved to Trash.", { action: { label: "Undo", onClick: () => void undoDelete() } });
      await invalidateTransactionScopes(queryClient, { previous: transaction, timezone });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    }
  }

  async function undoDelete() {
    if (!undo || restoring.current) return;
    const item = undo;
    restoring.current = true;
    try {
      await restore.mutateAsync({ transactionId: item.id });
      await invalidateTransactionScopes(queryClient, { next: item, timezone });
      setUndo(undefined);
      setStatus({ kind: "success", text: "Transaction restored." });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) });
    } finally {
      restoring.current = false;
    }
  }

  if (transactions.isPending && items.length === 0) return <p className="loading-state">Loading transactions…</p>;
  if (transactions.isError && items.length === 0)
    return (
      <section>
        <h1>Transactions</h1>
        <p role="alert" className="field-error">Could not load transactions.</p>
        <Button type="button" onClick={() => void transactions.refetch()}>Retry</Button>
      </section>
    );

  return (
    <section className="management-page">
      <div className="page-heading">
        <div><p className="muted">All manual memos</p><h1>Transactions</h1></div>
        <Link className="button" href="/app/transactions/new">New transaction</Link>
      </div>
      <TransactionFilters query={query} onQueryChange={setQuery} />
      {status ? (
        <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>
          {status.text} {undo ? <Button type="button" variant="quiet" onClick={() => void undoDelete()} disabled={restoring.current}>Undo</Button> : null}
        </p>
      ) : null}
      {items.length === 0 ? (
        <div className="empty-state">
          <h2>No transactions match these filters</h2>
          <p>{query || Object.keys(filters).length ? "Clear filters or search to see more memos." : "Add your first memo."}</p>
          <Link className="button" href="/app/transactions/new">New transaction</Link>
        </div>
      ) : (
        <div className="card-list transaction-list">
          {items.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} timezone={timezone} onTrash={(item) => void remove(item)} />)}
        </div>
      )}
      {failedCursor ? (
        <div role="alert" className="field-error">
          Could not load more transactions. <Button type="button" onClick={() => void transactions.refetch()}>Retry</Button>
        </div>
      ) : null}
      {nextCursor && !failedCursor ? (
        <Button type="button" onClick={() => setCursor(nextCursor)} disabled={transactions.isFetching}>Load more</Button>
      ) : null}
    </section>
  );
}
