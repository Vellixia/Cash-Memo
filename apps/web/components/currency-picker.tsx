"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { currencyOptions, searchCurrencies, type CurrencyOption } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Searchable currency picker: a modal combobox (search field + grouped listbox) with Default, Recent and All
 * sections. The caller supplies the trigger's look; `children` is its content. */
export function CurrencyPicker({
  value,
  onChange,
  defaultCurrency,
  triggerClassName,
  triggerLabel,
  children,
}: {
  value: string;
  onChange: (code: string) => void;
  defaultCurrency?: string;
  triggerClassName?: string;
  triggerLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger render={<button type="button" aria-label={triggerLabel} className={triggerClassName} />}>
        {children}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[#1c1b19]/25 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        {/* Anchored to the top on phones so the on-screen keyboard doesn't cover the list. */}
        <DialogPrimitive.Popup
          initialFocus={searchRef}
          data-testid="currency-picker"
          className={cn(
            "fixed inset-x-3 top-[max(env(safe-area-inset-top),0.75rem)] z-50 flex max-h-[min(36rem,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-3xl bg-card text-card-foreground shadow-2xl ring-1 ring-border outline-none",
            "transition-[translate,opacity,scale] duration-200 data-ending-style:-translate-y-2 data-ending-style:opacity-0 data-starting-style:-translate-y-2 data-starting-style:opacity-0",
            "md:inset-x-auto md:top-[12vh] md:left-1/2 md:max-h-[70vh] md:w-[26rem] md:-translate-x-1/2",
          )}
        >
          {open && (
            <PickerBody
              value={value}
              defaultCurrency={defaultCurrency}
              searchRef={searchRef}
              onPick={(code) => {
                onChange(code);
                setOpen(false);
              }}
            />
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PickerBody({
  value,
  defaultCurrency,
  searchRef,
  onPick,
}: {
  value: string;
  defaultCurrency?: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onPick: (code: string) => void;
}) {
  const baseId = useId();
  const recent = useUiStore((s) => s.recentCurrencies);
  const [query, setQuery] = useState("");
  const all = currencyOptions();
  const byCode = useMemo(() => new Map(all.map((o) => [o.code, o])), [all]);
  const find = (code: string): CurrencyOption => byCode.get(code) ?? { code, name: code, symbol: code };

  const sections = query.trim()
    ? [{ label: "Results", items: searchCurrencies(query, all) }]
    : [
        { label: "Default", items: defaultCurrency ? [find(defaultCurrency)] : [] },
        { label: "Recent", items: recent.filter((c) => c !== defaultCurrency).map(find) },
        { label: "All", items: all },
      ].filter((s) => s.items.length > 0);
  const flat = sections.flatMap((s, si) => s.items.map((o) => ({ id: `${baseId}-${si}-${o.code}`, o })));
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((f) => f.o.code === value)));
  const activeId = flat[active]?.id;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
    if (step) {
      e.preventDefault();
      setActive((a) => Math.min(Math.max(a + step, 0), flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) onPick(flat[active].o.code);
    }
  }

  const listId = `${baseId}-list`;
  let index = -1;

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <DialogPrimitive.Title className="font-serif text-xl">Currency</DialogPrimitive.Title>
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
            aria-label="Search currencies"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            placeholder="Search name, code or symbol"
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
          {query.trim() ? `${flat.length} ${flat.length === 1 ? "currency" : "currencies"}` : ""}
        </p>
      </div>
      <div id={listId} role="listbox" aria-label="Currencies" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No currency matches “{query.trim()}”.</p>}
        {sections.map((section, si) => (
          <div key={section.label} role="group" aria-labelledby={`${baseId}-g${si}`}>
            <div id={`${baseId}-g${si}`} className="px-3 pt-3 pb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
              {section.label}
            </div>
            {section.items.map((o) => {
              const i = ++index;
              const selected = o.code === value;
              return (
                <div
                  key={o.code}
                  id={flat[i].id}
                  role="option"
                  aria-selected={selected}
                  data-active={i === active || undefined}
                  onClick={() => onPick(o.code)}
                  onPointerMove={() => i !== active && setActive(i)}
                  className="flex min-h-11 cursor-default items-center gap-3 rounded-xl px-3 text-sm select-none data-active:bg-muted md:min-h-10"
                >
                  <span className="w-10 shrink-0 text-xs font-semibold tracking-wider">{o.code}</span>
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.symbol !== o.code && <span className="shrink-0 text-muted-foreground">{o.symbol}</span>}
                  <Check className={cn("size-4 shrink-0 text-income", !selected && "invisible")} aria-hidden />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
