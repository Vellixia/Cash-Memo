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

function month(occurredAt: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(occurredAt));
  const values = Object.fromEntries(
    parts.filter(({ type }) => type === "year" || type === "month").map(({ type, value }) => [type, value]),
  ) as { year: string; month: string };
  return `${values.year}-${values.month}`;
}

function keys(scope: Scope, timezone: string) {
  const scopeMonth = month(scope.occurred_at, timezone);
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
  { previous, next, timezone = "UTC" }: { previous?: Scope; next?: Scope; timezone?: string },
) {
  const scopes = [previous, next].filter((scope): scope is Scope => Boolean(scope));
  const queryKeys = scopes
    .flatMap((scope) => keys(scope, timezone))
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
