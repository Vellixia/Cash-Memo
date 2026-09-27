"use client";

import { useLayoutEffect, useReducer, useRef } from "react";
import { useController, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { editAmount, exponent, formatAmountInput, fromMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A money amount field: shows the canonical form value natively grouped, re-groups as you type and
 * keeps the caret after the same digit (lib/money.ts editAmount does the work). `big` grows the text
 * as digits pile up (the memo editor's hero amount); otherwise it's a fixed, normal size. */
export function AmountField<T extends FieldValues>({
  control,
  name,
  currency,
  invalid,
  inputRef,
  className,
  big = true,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  currency: string;
  invalid: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
  big?: boolean;
}) {
  const { field } = useController({ control, name });
  const text = formatAmountInput((field.value as string) ?? "", currency);
  const el = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  // Re-render after every edit, even a rejected one, so the caret is restored.
  const [edits, bump] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => {
    const node = el.current;
    if (caret.current !== null && node && document.activeElement === node) node.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [edits]);

  return (
    <input
      ref={(node) => {
        el.current = node;
        if (inputRef) inputRef.current = node;
        field.ref(node);
      }}
      name={field.name}
      value={text}
      onBlur={field.onBlur}
      onChange={(e) => {
        const next = editAmount(text, e.target.value, e.target.selectionStart, currency, (e.nativeEvent as InputEvent).inputType);
        caret.current = next.caret;
        field.onChange(next.value);
        bump();
      }}
      aria-label="Amount"
      aria-invalid={invalid}
      inputMode={exponent(currency) ? "decimal" : "numeric"}
      autoComplete="off"
      placeholder={formatAmountInput(fromMinor(0, currency), currency)}
      className={cn(
        "num w-full min-w-0 bg-transparent text-center leading-none outline-none placeholder:text-muted-foreground/35",
        // Shrinks as digits pile up so long amounts still fit a 320px-wide sheet.
        big && (text.length > 11 ? "text-3xl" : text.length > 8 ? "text-4xl" : text.length > 6 ? "text-5xl" : "text-6xl"),
        className,
      )}
    />
  );
}
