"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api/client";
import type { components, operations } from "@/lib/api/generated";

export type CreateMoneyMemoRequest =
  components["schemas"]["MoneyMemoCreateRequest"];
export type MoneyMemo = components["schemas"]["MoneyMemo"];
export type CurrencyRegistry =
  operations["getSupportedCurrencies"]["responses"][200]["content"]["application/json"];
export type Label = components["schemas"]["Label"];

export const moneyMemoKeys = {
  active: ["money-memos", "active"] as const,
  currencies: ["reference", "currencies", "v1"] as const,
  labels: (kind: "category" | "money_space") =>
    ["labels", "active", kind] as const,
};

export function useCurrencies() {
  return useQuery({
    queryKey: moneyMemoKeys.currencies,
    queryFn: () => apiRequest<CurrencyRegistry>("/api/v1/reference/currencies"),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

export function useActiveLabels(kind: "category" | "money_space") {
  return useQuery({
    queryKey: moneyMemoKeys.labels(kind),
    queryFn: () =>
      apiRequest<{ items: Label[] }>("/api/v1/labels/query", {
        method: "POST",
        body: JSON.stringify({ kind, states: ["active"] }),
      }),
  });
}

export function useCreateMoneyMemo(options: {
  onRetainDraft: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateMoneyMemoRequest) =>
      apiRequest<MoneyMemo>("/api/v1/money-memos", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: moneyMemoKeys.active });
    },
    onError: async () => {
      await options.onRetainDraft();
    },
  });
}
