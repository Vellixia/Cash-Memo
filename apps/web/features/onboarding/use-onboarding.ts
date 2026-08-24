"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOnboardingQueryKey,
  getListCategoriesQueryKey,
  useGetOnboarding,
  useSeedOnboardingCategories,
  useUpdatePreferences,
} from "../../generated/api";
import type { OnboardingContract } from "../../generated/api/model/onboardingContract";

export type OnboardingStep = "timezone" | "currency" | "categories" | "wallet" | "complete";

export function onboardingComplete(state: OnboardingContract): boolean {
  return (
    state.timezone_configured &&
    state.default_currency_configured &&
    state.categories_seeded &&
    state.has_active_wallet
  );
}

export function onboardingNextStep(state: OnboardingContract): OnboardingStep {
  if (!state.timezone_configured) return "timezone";
  if (!state.default_currency_configured) return "currency";
  if (!state.categories_seeded) return "categories";
  if (!state.has_active_wallet) return "wallet";
  return "complete";
}

export function useOnboarding() {
  const queryClient = useQueryClient();
  const query = useGetOnboarding({ query: { retry: 1 } });
  const seed = useSeedOnboardingCategories();
  const preferences = useUpdatePreferences();
  const state = query.data?.data;

  async function seedCategories() {
    await seed.mutateAsync();
    await queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
  }

  async function savePreferences(data: { timezone: string; default_currency_code: string }) {
    await preferences.mutateAsync({ data });
    await queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
  }

  return {
    ...query,
    state,
    step: state ? onboardingNextStep(state) : undefined,
    seedCategories,
    savePreferences,
    isMutating: seed.isPending || preferences.isPending,
  };
}
