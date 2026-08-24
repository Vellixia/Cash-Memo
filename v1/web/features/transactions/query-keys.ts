import type { QueryClient } from "@tanstack/react-query";
import { getListTransactionsQueryKey, getListTrashedTransactionsQueryKey } from "../../generated/api";

interface Scope { wallet_id: string; category_id: string; occurred_at: string }

function month(occurredAt: string) {
  return occurredAt.slice(0, 7);
}

function monthEnd(value: string) {
  const [year, monthNumber] = value.split("-").map(Number);
  return `${value}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
}

function keys(scope: Scope) {
  const from = `${month(scope.occurred_at)}-01`;
  return [
    getListTransactionsQueryKey({ wallet_id: scope.wallet_id }),
    getListTransactionsQueryKey({ category_id: scope.category_id }),
    getListTransactionsQueryKey({ from, to: monthEnd(month(scope.occurred_at)) }),
  ];
}

export async function invalidateTransactionScopes(
  client: QueryClient,
  { previous, next }: { previous?: Scope; next?: Scope },
) {
  const scopes = [previous, next].filter((scope): scope is Scope => Boolean(scope));
  await Promise.all([
    ...scopes.flatMap((scope) => keys(scope).map((queryKey) => client.invalidateQueries({ queryKey }))),
    client.invalidateQueries({ queryKey: getListTrashedTransactionsQueryKey() }),
  ]);
}
