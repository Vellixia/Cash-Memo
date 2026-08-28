"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOnboardingQueryKey,
  useGetOnboarding,
  useUpdatePreferences,
} from "../../generated/api";
import type { OnboardingContract } from "../../generated/api/model/onboardingContract";

export type OnboardingStep = "timezone" | "currency" | "wallet" | "complete";

export function onboardingComplete(state: OnboardingContract): boolean {
  return (
    state.timezone_configured &&
    state.default_currency_configured &&
    state.has_active_wallet
  );
}

export function onboardingNextStep(state: OnboardingContract): OnboardingStep {
  if (!state.timezone_configured) return "timezone";
  if (!state.default_currency_configured) return "currency";
  if (!state.has_active_wallet) return "wallet";
  return "complete";
}

export function useOnboarding() {
  const queryClient = useQueryClient();
  const query = useGetOnboarding({ query: { retry: 1 } });
  const preferences = useUpdatePreferences();
  const state = query.data?.data;

  async function savePreferences(data: { timezone: string; default_currency_code: string }) {
    await preferences.mutateAsync({ data });
    await queryClient.invalidateQueries({ queryKey: getGetOnboardingQueryKey() });
  }

  return {
    ...query,
    state,
    step: state ? onboardingNextStep(state) : undefined,
    savePreferences,
    isMutating: preferences.isPending,
  };
}
