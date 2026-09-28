"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useMounted } from "@/lib/use-mounted";
import { useMe, useUpdateMe } from "@/lib/queries";
import type { Preferences } from "@/lib/api";

export const ACCENTS = ["ledger", "ocean", "plum", "amber", "rose", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];

export const FONTS = ["classic", "modern", "readable", "system", "rounded", "mono"] as const;
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

/**
 * Curated appearance presets (theme, accent, font pair, text size), stored per device like
 * next-themes' own light/dark (localStorage + data attributes, no flash — see the inline script in
 * app/layout.tsx), and mirrored on the account so a second device picks them up (roadmap: "saved on
 * the account"). On load, a server value that differs from the local one is applied once; after that
 * (or once the user changes anything locally) the server is never allowed to overwrite local state —
 * only local changes ever write to it, one field at a time.
 */
export function useAppearance() {
  const { theme, setTheme: setThemeRaw } = useTheme();
  const mounted = useMounted();
  const [accent, setAccentField] = useAppearanceField<Accent>("data-accent", "cm-accent", "ledger");
  const [font, setFontField] = useAppearanceField<Font>("data-font", "cm-font", "classic");
  const [size, setSizeField] = useAppearanceField<Size>("data-size", "cm-size", "default");

  const { data: me } = useMe();
  const updateMe = useUpdateMe();
  const synced = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!mounted || dirty.current || synced.current || !me) return;
    synced.current = true;
    const p = me.preferences;
    if (p.theme && p.theme !== (theme ?? "system")) setThemeRaw(p.theme);
    if (p.accent && p.accent !== accent) setAccentField(p.accent as Accent);
    if (p.font && p.font !== font) setFontField(p.font as Font);
    if (p.size && p.size !== size) setSizeField(p.size as Size);
    // Only ever re-checked when `me` first arrives; re-running on every field's own change would
    // fight the local write that just happened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, me]);

  function save(patch: Preferences) {
    dirty.current = true;
    updateMe.mutate({ preferences: patch });
  }

  const setTheme = useCallback(
    (v: string) => {
      setThemeRaw(v);
      save({ theme: v });
    },
    [setThemeRaw],
  );
  const setAccent = useCallback(
    (v: Accent) => {
      setAccentField(v);
      save({ accent: v });
    },
    [setAccentField],
  );
  const setFont = useCallback(
    (v: Font) => {
      setFontField(v);
      save({ font: v });
    },
    [setFontField],
  );
  const setSize = useCallback(
    (v: Size) => {
      setSizeField(v);
      save({ size: v });
    },
    [setSizeField],
  );

  return {
    theme: mounted ? ((theme as string) ?? "system") : "system",
    setTheme,
    accent,
    setAccent,
    font,
    setFont,
    size,
    setSize,
  };
}
