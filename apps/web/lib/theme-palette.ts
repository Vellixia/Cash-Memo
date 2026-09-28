/**
 * Accent palette values, kept in one place so lib/theme-palette.test.ts can verify contrast without
 * parsing CSS. app/globals.css's `[data-accent="…"]` blocks are hand-derived from these same numbers
 * (each accent tints background/card/muted/border/accent by a small, fixed amount toward its primary;
 * see the CSS file's comment) — this module is the source of truth for what those numbers *should* be.
 * "ledger" is the default accent (no override in globals.css) and doubles as the income color, so it's
 * listed here too but left untinted, same as the CSS.
 */
export type Mode = "light" | "dark";
export type AccentName = "ledger" | "ocean" | "plum" | "amber" | "rose" | "graphite";

type Tokens = {
  background: string;
  foreground: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
};

const BASE: Record<Mode, { foreground: string; mutedForeground: string }> = {
  light: { foreground: "#1c1b19", mutedForeground: "#6b6760" },
  dark: { foreground: "#f2efe9", mutedForeground: "#a39e94" },
};

export const PALETTE: Record<AccentName, Record<Mode, Tokens>> = {
  ledger: {
    light: { ...BASE.light, background: "#faf8f4", primary: "#1f7a5c", primaryForeground: "#ffffff" },
    dark: { ...BASE.dark, background: "#151412", primary: "#4cc49a", primaryForeground: "#0d2219" },
  },
  ocean: {
    light: { ...BASE.light, background: "#f4f5f2", primary: "#1c6ea4", primaryForeground: "#ffffff" },
    dark: { ...BASE.dark, background: "#171817", primary: "#5aa9e6", primaryForeground: "#08202f" },
  },
  plum: {
    light: { ...BASE.light, background: "#f7f3f1", primary: "#74408f", primaryForeground: "#ffffff" },
    dark: { ...BASE.dark, background: "#191717", primary: "#c496e8", primaryForeground: "#2a1236" },
  },
  amber: {
    light: { ...BASE.light, background: "#f8f4ee", primary: "#a15c00", primaryForeground: "#ffffff" },
    dark: { ...BASE.dark, background: "#1a1813", primary: "#e8b64a", primaryForeground: "#2e1c00" },
  },
  rose: {
    light: { ...BASE.light, background: "#f8f3f0", primary: "#b23a5e", primaryForeground: "#ffffff" },
    dark: { ...BASE.dark, background: "#1a1716", primary: "#f091ae", primaryForeground: "#3a0f1e" },
  },
  graphite: {
    light: { ...BASE.light, background: "#f6f4ef", primary: "#4a473f", primaryForeground: "#ffffff" },
    dark: { ...BASE.dark, background: "#1a1816", primary: "#c9c4ba", primaryForeground: "#211f1a" },
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance (sRGB, gamma-corrected). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors, order-independent, 1:1 to 21:1. */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}
