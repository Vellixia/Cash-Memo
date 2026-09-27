"use client";

import { useCallback, useState } from "react";
import { useMounted } from "@/lib/use-mounted";

export const ACCENTS = ["ledger", "ocean", "plum", "amber", "rose", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];

export const FONTS = ["classic", "modern", "readable", "system"] as const;
export type Font = (typeof FONTS)[number];

export const SIZES = ["default", "large"] as const;
export type Size = (typeof SIZES)[number];

/**
 * One field of the appearance state: reads/writes an html data attribute + its localStorage key.
 * The inline script in <head> sets the attribute before paint; `mounted` gates reading it back
 * (SSR/first paint always shows `fallback`, matching next-themes' own mounted-gate pattern here).
 */
function useAppearanceField<T extends string>(attr: string, storageKey: string, fallback: T) {
  const mounted = useMounted();
  const [override, setOverride] = useState<T | null>(null);
  const value = override ?? (mounted ? ((document.documentElement.getAttribute(attr) as T | null) ?? fallback) : fallback);

  const set = useCallback(
    (next: T) => {
      setOverride(next);
      document.documentElement.setAttribute(attr, next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Private mode / blocked storage: the attribute still applies for this page view.
      }
    },
    [attr, storageKey],
  );

  return [value, set] as const;
}

/** Curated appearance presets (accent, font pair, text size), stored per device like next-themes' light/dark. */
export function useAppearance() {
  const [accent, setAccent] = useAppearanceField<Accent>("data-accent", "cm-accent", "ledger");
  const [font, setFont] = useAppearanceField<Font>("data-font", "cm-font", "classic");
  const [size, setSize] = useAppearanceField<Size>("data-size", "cm-size", "default");
  return { accent, setAccent, font, setFont, size, setSize };
}
