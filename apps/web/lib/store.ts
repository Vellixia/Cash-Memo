import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Memo } from "@/lib/api";
import { currentMonth } from "@/lib/format";

type UiState = {
  month: string;
  setMonth: (month: string) => void;
  /** Currency the hero + category breakdown show when a month has several. */
  currency: string | null;
  setCurrency: (currency: string) => void;
  lastCurrency: string;
  setLastCurrency: (currency: string) => void;
  /** Memo editor (sheet on mobile, dialog on desktop). `editorKey` remounts the form per open. */
  editorOpen: boolean;
  editing: Memo | null;
  editorKey: number;
  openEditor: (memo?: Memo) => void;
  closeEditor: () => void;
};

/** Client-only UI state. Only `lastCurrency` is persisted, so new memos default sensibly. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      month: currentMonth(),
      setMonth: (month) => set({ month }),
      currency: null,
      setCurrency: (currency) => set({ currency }),
      lastCurrency: "USD",
      setLastCurrency: (currency) => set({ lastCurrency: currency }),
      editorOpen: false,
      editing: null,
      editorKey: 0,
      openEditor: (memo) => set((s) => ({ editorOpen: true, editing: memo ?? null, editorKey: s.editorKey + 1 })),
      // Keep `editing` so the closing animation still shows the same form.
      closeEditor: () => set({ editorOpen: false }),
    }),
    {
      name: "cashmemo:ui",
      partialize: (state) => ({ lastCurrency: state.lastCurrency }),
    },
  ),
);
