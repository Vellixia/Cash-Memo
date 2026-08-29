import type { QueryClient } from "@tanstack/react-query";
import {
  getGetBudgetSummaryQueryKey,
  getGetMonthlySummaryQueryKey,
  getGetOnboardingQueryKey,
  getGetRecentTransactionsQueryKey,
  getGetTransactionEntryDefaultsQueryKey,
  getListBudgetsQueryKey,
  getListTransactionsQueryKey,
} from "../../generated/api";

/** Mark every private view whose local date/month interpretation depends on timezone stale. */
export async function invalidateTimezoneDependentQueries(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: getGetOnboardingQueryKey() }),
    client.invalidateQueries({ queryKey: getGetTransactionEntryDefaultsQueryKey() }),
    client.invalidateQueries({ queryKey: getListTransactionsQueryKey() }),
    client.invalidateQueries({ queryKey: getGetMonthlySummaryQueryKey() }),
    client.invalidateQueries({ queryKey: getGetBudgetSummaryQueryKey() }),
    client.invalidateQueries({ queryKey: getListBudgetsQueryKey() }),
    client.invalidateQueries({ queryKey: getGetRecentTransactionsQueryKey() }),
  ]);
}
