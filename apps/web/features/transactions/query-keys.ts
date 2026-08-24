import type { QueryClient } from "@tanstack/react-query";
import {
  getGetBudgetSummaryQueryKey,
  getGetMonthlySummaryQueryKey,
  getGetWalletQueryKey,
  getListBudgetsQueryKey,
  getListCategoriesQueryKey,
  getListTransactionsQueryKey,
  getListTrashedTransactionsQueryKey,
  getListWalletsQueryKey,
} from "../../generated/api";
import { historyMonthBounds } from "./history-params";

interface Scope {
  wallet_id: string;
  category_id: string;
  occurred_at: string;
}

function month(occurredAt: string) {
  return occurredAt.slice(0, 7);
}

function keys(scope: Scope) {
  const scopeMonth = month(scope.occurred_at);
  return [
    getListTransactionsQueryKey({ wallet_id: scope.wallet_id }),
    getListTransactionsQueryKey({ category_id: scope.category_id }),
    getListTransactionsQueryKey(historyMonthBounds(scopeMonth)),
    getGetWalletQueryKey(scope.wallet_id),
    getListWalletsQueryKey(),
    getListCategoriesQueryKey(),
    getListBudgetsQueryKey({ month: scopeMonth }),
    getGetBudgetSummaryQueryKey({ month: scopeMonth }),
    getGetMonthlySummaryQueryKey({ month: scopeMonth }),
  ];
}

export async function invalidateTransactionScopes(
  client: QueryClient,
  { previous, next }: { previous?: Scope; next?: Scope },
) {
  const scopes = [previous, next].filter((scope): scope is Scope => Boolean(scope));
  const queryKeys = scopes
    .flatMap(keys)
    .filter(
      (queryKey, index, keysForScopes) =>
        keysForScopes.findIndex((value) => JSON.stringify(value) === JSON.stringify(queryKey)) ===
        index,
    );
  await Promise.all([
    ...queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })),
    client.invalidateQueries({ queryKey: getListTrashedTransactionsQueryKey() }),
  ]);
}
