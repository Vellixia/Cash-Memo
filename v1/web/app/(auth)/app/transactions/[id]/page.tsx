"use client";

import { useParams } from "next/navigation";
import { Button } from "../../../../../components/ui/button";
import { useGetTransaction } from "../../../../../generated/api";
import { TransactionForm } from "../../../../../features/transactions/form";

export default function EditTransactionPage() {
  const params = useParams<{ id: string }>();
  const transaction = useGetTransaction(params.id, { query: { retry: 1 } });
  if (transaction.isPending) return <p className="loading-state">Loading transaction…</p>;
  if (transaction.isError) return <section><h1>Transaction</h1><p role="alert" className="field-error">Could not load transaction.</p><Button type="button" onClick={() => void transaction.refetch()}>Retry</Button></section>;
  return <TransactionForm transaction={transaction.data.data} />;
}
