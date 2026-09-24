"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { firstGrapheme } from "@/lib/format";
import { cn } from "@/lib/utils";

const SUGGESTED = [
  "🍜", "☕", "🛒", "🍷", "🚌", "🚗", "⛽", "✈️",
  "🛍️", "👕", "🏠", "🧾", "💡", "📱", "🩺", "💊",
  "🎉", "🎬", "🎮", "📚", "🐾", "🎁", "💇", "🏋️",
  "💼", "💰", "📈", "🏦", "🪙", "💸", "🧑‍💻", "🌱",
];

/** Emoji picker: a button that opens a small grid of suggestions plus free input. */
export function EmojiField({
  value,
  onChange,
  label = "Choose emoji",
  className,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  function pick(emoji: string | null) {
    onChange(emoji);
    setCustom("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-input bg-card text-lg transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40",
          className,
        )}
      >
        {value || <span className="text-sm text-muted-foreground opacity-60 grayscale">🙂</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3 p-3">
        <div className="grid grid-cols-8 gap-1" role="group" aria-label="Suggested emoji">
          {SUGGESTED.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => pick(e)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-lg text-lg hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                value === e && "bg-muted ring-1 ring-border",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Type any emoji"
            placeholder="Or type one…"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (firstGrapheme(custom)) pick(firstGrapheme(custom));
              }
            }}
            className="h-8"
          />
          {value && (
            <button type="button" onClick={() => pick(null)} className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground">
              Remove
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
