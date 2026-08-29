import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  getGetBudgetSummaryQueryKey,
  getGetMonthlySummaryQueryKey,
  getGetOnboardingQueryKey,
  getGetRecentTransactionsQueryKey,
  getGetTransactionEntryDefaultsQueryKey,
  getListBudgetsQueryKey,
  getListTransactionsQueryKey,
} from "../generated/api";
import { invalidateTimezoneDependentQueries } from "../features/settings/timezone-invalidation";

describe("timezone preference invalidation", () => {
  it("invalidates real parameterized private caches without rewriting cached values", async () => {
    const client = new QueryClient();
    const entries = [
      [getGetOnboardingQueryKey(), { timezone: "UTC" }],
      [getGetTransactionEntryDefaultsQueryKey(), { timezone: "UTC" }],
      [getListTransactionsQueryKey({ wallet_id: "wallet-1" }), { items: [{ id: "txn-1" }] }],
      [getGetMonthlySummaryQueryKey({ month: "2026-01" }), { month: "2026-01" }],
      [getListBudgetsQueryKey({ month: "2026-01" }), { items: [{ id: "budget-1" }] }],
      [getGetBudgetSummaryQueryKey({ month: "2026-01" }), { month: "2026-01" }],
      [getGetRecentTransactionsQueryKey({ month: "2026-01" }), { items: [{ id: "txn-1" }] }],
    ] as const;
    for (const [key, value] of entries) client.setQueryData(key, value);

    await invalidateTimezoneDependentQueries(client);

    for (const [key, value] of entries) {
      expect(client.getQueryData(key)).toEqual(value);
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
