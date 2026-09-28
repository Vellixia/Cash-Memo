"use client";

import { Check } from "lucide-react";
import { Segmented } from "@/components/segmented";
import { ACCENTS, FONTS, useAppearance, type Accent, type Font } from "@/lib/appearance";
import { cn } from "@/lib/utils";

/** Light-mode primary of each accent, just for the swatch fill (see globals.css for both modes + contrast). */
const ACCENT_SWATCH: Record<Accent, string> = {
  ledger: "#1f7a5c",
  ocean: "#1c6ea4",
  plum: "#74408f",
  amber: "#a15c00",
  rose: "#b23a5e",
  graphite: "#4a473f",
};

const ACCENT_LABEL: Record<Accent, string> = {
  ledger: "Ledger",
  ocean: "Ocean",
  plum: "Plum",
  amber: "Amber",
  rose: "Rose",
  graphite: "Graphite",
};

const FONT_LABEL: Record<Font, string> = {
  classic: "Classic",
  modern: "Modern",
  readable: "Readable",
  system: "System",
  rounded: "Rounded",
  mono: "Mono numbers",
};

/** Preview families for each pair, independent of the page's own active --app-* vars (mirrors globals.css). */
const FONT_HEADING_PREVIEW: Record<Font, string> = {
  classic: "var(--font-fraunces), ui-serif, Georgia, serif",
  modern: "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  readable: "var(--font-atkinson), ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, sans-serif",
  rounded: "var(--font-quicksand), ui-sans-serif, system-ui, sans-serif",
  mono: "ui-sans-serif, system-ui, sans-serif",
};
const FONT_NUM_PREVIEW: Record<Font, string> = {
  classic: "var(--font-fraunces), ui-serif, Georgia, serif",
  modern: "var(--font-geist-mono), ui-monospace, monospace",
  readable: "var(--font-atkinson), ui-serif, Georgia, serif",
  system: "ui-serif, Georgia, serif",
  rounded: "var(--font-quicksand), ui-sans-serif, system-ui, sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, monospace",
};

/** Moves roving focus within a radiogroup by arrow key, wrapping around. */
function useRovingArrowKeys<T extends string>(values: readonly T[], current: T, onChange: (v: T) => void) {
  return (e: React.KeyboardEvent, dataAttr: string) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const i = values.indexOf(current);
    const next = values[(i + (forward ? 1 : -1) + values.length) % values.length];
    onChange(next);
    (e.currentTarget.querySelector(`[${dataAttr}="${next}"]`) as HTMLElement | null)?.focus();
  };
}

function AccentPicker({ accent, setAccent }: { accent: Accent; setAccent: (a: Accent) => void }) {
  const onKeyDown = useRovingArrowKeys(ACCENTS, accent, setAccent);
  return (
    <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-3" onKeyDown={(e) => onKeyDown(e, "data-accent-swatch")}>
      {ACCENTS.map((a) => {
        const active = a === accent;
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={ACCENT_LABEL[a]}
            data-accent-swatch={a}
            tabIndex={active ? 0 : -1}
            onClick={() => setAccent(a)}
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-card transition-shadow focus-visible:ring-3 focus-visible:ring-ring/40",
              active && "ring-2 ring-foreground",
            )}
            style={{ backgroundColor: ACCENT_SWATCH[a] }}
          >
            {active && <Check className="size-4 text-white" strokeWidth={3} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

function FontPicker({ font, setFont }: { font: Font; setFont: (f: Font) => void }) {
  const onKeyDown = useRovingArrowKeys(FONTS, font, setFont);
  return (
    <div role="radiogroup" aria-label="Font pair" className="grid grid-cols-2 gap-2" onKeyDown={(e) => onKeyDown(e, "data-font-option")}>
      {FONTS.map((f) => {
        const active = f === font;
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={active}
            data-font-option={f}
            tabIndex={active ? 0 : -1}
            onClick={() => setFont(f)}
            className={cn(
              "space-y-1 rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
              active ? "border-primary bg-primary/10" : "border-input bg-card hover:bg-muted",
            )}
          >
            <span className={cn("block text-xs font-medium", active ? "text-foreground" : "text-muted-foreground")}>{FONT_LABEL[f]}</span>
            {/* The preview itself: a short heading plus a money value, each in that pair's own fonts. */}
            <span className="flex items-baseline gap-2 overflow-hidden">
              <span className="truncate text-base" style={{ fontFamily: FONT_HEADING_PREVIEW[f] }}>
                Cash Memo
              </span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground" style={{ fontFamily: FONT_NUM_PREVIEW[f] }}>
                $1,234.56
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Accent, font pair and text size — curated presets, saved locally and synced to the account (lib/appearance.ts). */
export function AppearanceSettings() {
  const { accent, setAccent, font, setFont, size, setSize } = useAppearance();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Accent</p>
        <AccentPicker accent={accent} setAccent={setAccent} />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Font</p>
        <FontPicker font={font} setFont={setFont} />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Text size</p>
        <Segmented
          label="Text size"
          size="sm"
          value={size}
          onChange={setSize}
          options={[
            { value: "default", label: "Default" },
            { value: "large", label: "Large" },
          ]}
        />
      </div>
    </div>
  );
}
