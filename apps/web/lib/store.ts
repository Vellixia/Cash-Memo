import { create } from "zustand";
import { persist } from "zustand/middleware";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type UiState = {
  month: string;
  setMonth: (month: string) => void;
  lastCurrency: string;
  setLastCurrency: (currency: string) => void;
};

/** Client-only UI state: selected month (session, not persisted) and the
 * last currency used on a memo (persisted so new memos default sensibly). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      month: currentMonth(),
      setMonth: (month) => set({ month }),
      lastCurrency: "USD",
      setLastCurrency: (currency) => set({ lastCurrency: currency }),
    }),
    {
      name: "cashmemo:ui",
      partialize: (state) => ({ lastCurrency: state.lastCurrency }),
    },
  ),
);
