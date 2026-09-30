"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Choice = { id: string; name: string; emoji: string | null };

/** How many chips show inline before the rest move behind "More…". */
const INLINE = 5;

export const chipClass =
  "inline-flex h-9 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-3 pointer-coarse:h-11 pointer-coarse:px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

/** A wrapping row of the first few choices (the selected one always among them), a "More…" chip opening a
 * searchable picker with the full list once there are more, then `children` (e.g. a "New" chip). */
export function ChoiceChips({
  label,
  moreLabel,
  items,
  value,
  onChange,
  activeClassName,
  children,
}: {
  label: string;
  moreLabel: string;
  items: Choice[];
  value: string | null;
  onChange: (id: string | null) => void;
  activeClassName: string;
  children?: React.ReactNode;
}) {
  const shown = items.slice(0, INLINE);
  const selected = items.find((c) => c.id === value);
  if (selected && !shown.includes(selected)) shown[INLINE - 1] = selected;

  return (
    <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label={label}>
      {shown.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : c.id)}
            title={c.name}
            className={cn(chipClass, active ? activeClassName : "border-border bg-card text-foreground hover:bg-muted")}
          >
            {c.emoji && <span aria-hidden>{c.emoji}</span>}
            <span className="truncate">{c.name}</span>
            {active && <Check className="size-3.5 shrink-0" aria-hidden />}
          </button>
        );
      })}
      {items.length > INLINE && <ChoicePicker title={label} moreLabel={moreLabel} items={items} value={value} onPick={onChange} />}
      {children}
    </div>
  );
}

function ChoicePicker({
  title,
  moreLabel,
  items,
  value,
  onPick,
}: {
  title: string;
  moreLabel: string;
  items: Choice[];
  value: string | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={<button type="button" aria-label={moreLabel} className={cn(chipClass, "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground")} />}
      >
        More…
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[#1c1b19]/25 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        {/* Anchored to the top on phones so the on-screen keyboard doesn't cover the list. */}
        <DialogPrimitive.Popup
          initialFocus={searchRef}
          data-testid="choice-picker"
          className={cn(
            "fixed inset-x-3 top-[max(env(safe-area-inset-top),0.75rem)] z-50 flex max-h-[min(36rem,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-3xl bg-card text-card-foreground shadow-2xl ring-1 ring-border outline-none",
            "transition-[translate,opacity,scale] duration-200 data-ending-style:-translate-y-2 data-ending-style:opacity-0 data-starting-style:-translate-y-2 data-starting-style:opacity-0",
            "md:inset-x-auto md:top-[12vh] md:left-1/2 md:max-h-[70vh] md:w-[26rem] md:-translate-x-1/2",
          )}
        >
          {open && (
            <PickerBody
              title={title}
              items={items}
              value={value}
              searchRef={searchRef}
              onPick={(id) => {
                onPick(id);
                setOpen(false);
              }}
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Search field + listbox, keyboard-driven like the currency picker. */
function PickerBody({
  title,
  items,
  value,
  searchRef,
  onPick,
}: {
  title: string;
  items: Choice[];
  value: string | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onPick: (id: string) => void;
}) {
  const baseId = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q ? items.filter((c) => c.name.toLowerCase().includes(q)) : items;
  const [active, setActive] = useState(() => Math.max(0, matches.findIndex((c) => c.id === value)));
  const activeId = matches[active] ? `${baseId}-${matches[active].id}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
    if (step) {
      e.preventDefault();
      setActive((a) => Math.min(Math.max(a + step, 0), matches.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) onPick(matches[active].id);
    }
  }

  const listId = `${baseId}-list`;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <DialogPrimitive.Title className="min-w-0 truncate font-serif text-xl">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close
          render={<Button type="button" variant="ghost" size="icon" className="-mr-2 size-11 rounded-full md:size-9" aria-label="Close" />}
        >
          <X />
        </DialogPrimitive.Close>
      </div>
      <div className="px-4 pt-2 pb-2">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-input bg-background px-3 focus-within:ring-3 focus-within:ring-ring/40">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            role="combobox"
            aria-label={`Search ${title.toLowerCase()}`}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            placeholder="Search"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        <p className="sr-only" aria-live="polite">
          {q ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : ""}
        </p>
      </div>
      <div id={listId} role="listbox" aria-label={title} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {matches.length === 0 && <p className="px-3 py-6 text-center text-sm wrap-anywhere text-muted-foreground">Nothing matches “{query.trim()}”.</p>}
        {matches.map((c, i) => {
          const selected = c.id === value;
          return (
            <div
              key={c.id}
              id={`${baseId}-${c.id}`}
              role="option"
              aria-selected={selected}
              data-active={i === active || undefined}
              onClick={() => onPick(c.id)}
              onPointerMove={() => i !== active && setActive(i)}
              className="flex min-h-11 cursor-default items-center gap-3 rounded-xl px-3 text-sm select-none data-active:bg-muted md:min-h-10"
            >
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {c.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <Check className={cn("size-4 shrink-0 text-income", !selected && "invisible")} aria-hidden />
            </div>
          );
        })}
      </div>
    </>
  );
}
