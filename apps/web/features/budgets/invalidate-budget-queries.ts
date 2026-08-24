import type { QueryClient } from "@tanstack/react-query";
import {
  getGetBudgetSummaryQueryKey,
  getGetMonthlySummaryQueryKey,
  getListBudgetsQueryKey,
} from "../../generated/api";

export async function invalidateBudgetQueries(client: QueryClient, months: string[]) {
  const uniqueMonths = [...new Set(months.filter(Boolean))];
  const queryKeys = [
    getListBudgetsQueryKey(),
    getGetBudgetSummaryQueryKey(),
    getGetMonthlySummaryQueryKey(),
    ...uniqueMonths.flatMap((month) => [
      getListBudgetsQueryKey({ month }),
      getGetBudgetSummaryQueryKey({ month }),
      getGetMonthlySummaryQueryKey({ month }),
    ]),
  ];

  await Promise.all(
    queryKeys.map((queryKey) => client.invalidateQueries({ queryKey, exact: true })),
  );
}
