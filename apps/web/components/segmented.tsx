"use client";

import { cn } from "@/lib/utils";

type Option<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Accessible name when `label` is an icon. */
  ariaLabel?: string;
  tone?: "income" | "expense";
};

const ACTIVE_TONE = {
  neutral: "bg-card text-foreground shadow-paper ring-1 ring-border dark:bg-accent",
  income: "bg-income text-white dark:text-[#0d2219] shadow-paper",
  expense: "bg-expense text-white dark:text-[#2a110b] shadow-paper",
};

/** A small radio-group of pill buttons on a muted track. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-full bg-muted p-1", className)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = options.findIndex((o) => o.value === value);
        const next = options[(i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
        onChange(next.value);
        (e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.ariaLabel}
            data-value={o.value}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
              // Coarse pointers (touch) get taller pills; with the track padding that's a ≥44px target.
              size === "sm" ? "h-7 px-3 text-xs pointer-coarse:h-9 pointer-coarse:text-sm" : "h-9 px-4 text-sm pointer-coarse:h-10",
              active ? ACTIVE_TONE[o.tone ?? "neutral"] : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
