"use client";

import { create } from "zustand";

import type { PatternDecision } from "@/lib/privacy/pattern-set-v1";

type ComposeInterfaceState = {
  submitting: boolean;
  privacyDecision: PatternDecision;
  warningContinued: boolean;
  safeValidationFields: string[];
  setSubmitting: (value: boolean) => void;
  setPrivacyDecision: (value: PatternDecision) => void;
  continueWarning: () => void;
  setSafeValidationFields: (fields: string[]) => void;
  resetInterface: () => void;
};

const initial = {
  submitting: false,
  privacyDecision: { kind: "clear" } as const,
  warningContinued: false,
  safeValidationFields: [] as string[],
};

/** Ephemeral interface state only. Durable draft fields live exclusively in Dexie. */
export const useComposeStore = create<ComposeInterfaceState>((set) => ({
  ...initial,
  setSubmitting: (submitting) => set({ submitting }),
  setPrivacyDecision: (privacyDecision) =>
    set({ privacyDecision, warningContinued: false }),
  continueWarning: () => set({ warningContinued: true }),
  setSafeValidationFields: (safeValidationFields) =>
    set({ safeValidationFields }),
  resetInterface: () => set(initial),
}));
