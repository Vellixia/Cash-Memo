"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useController, useForm, useWatch, type Control } from "react-hook-form";
import { z } from "zod";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Segmented } from "@/components/segmented";
import { EmojiField } from "@/components/emoji-field";
import { OfflineHint } from "@/components/offline-hint";
import { CurrencyPicker } from "@/components/currency-picker";
import type { Direction, Memo } from "@/lib/api";
import { editAmount, exponent, fitAmount, formatAmountInput, fromMinor, toMinor } from "@/lib/money";
import { toDatetimeLocal } from "@/lib/format";
import { useCategories, useCreateCategory, useCreateMemo, useDeleteMemo, useMe, useUpdateMemo } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    direction: z.enum(["expense", "income"]),
    // Canonical "1234.5" (the field shows it natively grouped); see lib/money.ts editAmount.
    amount: z
      .string()
      .min(1, "Enter an amount")
      .regex(/^\d+(\.\d*)?$/, "Enter a number like 12.50"),
    currency: z.string().regex(/^[A-Z]{3}$/, "Pick a currency"),
    occurred_at: z.string().min(1, "Pick a date and time"),
    category_id: z.string().nullable(),
    note: z.string().max(2000, "Keep notes under 2000 characters"),
  })
  .superRefine((v, ctx) => {
    if (/^[A-Z]{3}$/.test(v.currency) && /\d/.test(v.amount) && toMinor(v.amount, v.currency) <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero" });
    }
  });
type Values = z.infer<typeof schema>;

/** Height of the on-screen keyboard (0 when closed), so the sheet and its Save button sit above it.
 * ponytail: visualViewport heuristic; switch to the VirtualKeyboard API / interactive-widget meta if it misfires. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** Add/edit memo: a bottom sheet below `md`, a centered dialog from `md` up (same element, CSS only). */
export function MemoEditor() {
  const open = useUiStore((s) => s.editorOpen);
  const editing = useUiStore((s) => s.editing);
  const editorKey = useUiStore((s) => s.editorKey);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const keyboard = useKeyboardInset();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && closeEditor()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[#1c1b19]/25 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        <DialogPrimitive.Popup
          initialFocus={amountRef}
          data-testid="memo-editor"
          style={{ "--kb": `${keyboard}px` } as React.CSSProperties}
          className={cn(
            "fixed inset-x-0 bottom-(--kb) z-50 flex max-h-[calc(92dvh-var(--kb))] flex-col overflow-hidden rounded-t-[1.75rem] bg-card text-card-foreground shadow-2xl ring-1 ring-border outline-none",
            "transition-[translate,opacity,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-y-full data-starting-style:translate-y-full",
            "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[90dvh] md:w-[min(28rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.75rem] md:duration-200",
            "md:data-ending-style:-translate-y-1/2 md:data-ending-style:scale-95 md:data-ending-style:opacity-0 md:data-starting-style:-translate-y-1/2 md:data-starting-style:scale-95 md:data-starting-style:opacity-0",
          )}
        >
          <div data-testid="sheet-handle" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border md:hidden" aria-hidden />
          <MemoForm key={editorKey} memo={editing} amountRef={amountRef} onDone={closeEditor} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function MemoForm({
  memo,
  amountRef,
  onDone,
}: {
  memo: Memo | null;
  amountRef: React.RefObject<HTMLInputElement | null>;
  onDone: () => void;
}) {
  const recentCurrencies = useUiStore((s) => s.recentCurrencies);
  const noteCurrency = useUiStore((s) => s.noteCurrency);
  const { data: me } = useMe();
  const { data: categories = [] } = useCategories();
  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();
  const deleteMemo = useDeleteMemo();
  const online = useOnline();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: memo?.direction ?? "expense",
      amount: memo ? fromMinor(memo.amount_minor, memo.currency) : "",
      currency: memo?.currency ?? me?.default_currency ?? recentCurrencies[0] ?? "USD",
      occurred_at: toDatetimeLocal(memo ? new Date(memo.occurred_at) : new Date()),
      category_id: memo?.category_id ?? null,
      note: memo?.note ?? "",
    },
  });

  const [direction, currency, categoryId] = useWatch({ control, name: ["direction", "currency", "category_id"] });
  const choices = categories.filter((c) => c.direction === direction);
  const saving = createMemo.isPending || updateMemo.isPending;

  function setDirection(d: Direction) {
    setValue("direction", d);
    const current = categories.find((c) => c.id === categoryId);
    if (current && current.direction !== d) setValue("category_id", null);
  }

  async function onSubmit(values: Values) {
    if (!online) return;
    const cur = values.currency;
    const body = {
      direction: values.direction,
      amount_minor: toMinor(values.amount, cur),
      currency: cur,
      occurred_at: new Date(values.occurred_at).toISOString(),
      category_id: values.category_id,
      note: values.note.trim() || null,
    };
    try {
      if (memo) {
        await updateMemo.mutateAsync({ id: memo.id, input: body });
        toast.success("Memo updated");
      } else {
        await createMemo.mutateAsync(body);
        toast.success(values.direction === "income" ? "Income added" : "Expense added");
      }
      noteCurrency(cur);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save memo");
    }
  }

  async function onDelete() {
    if (!memo) return;
    try {
      await deleteMemo.mutateAsync(memo.id);
      toast.success("Memo deleted");
      setConfirmDelete(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete memo");
    }
  }

  const tone = direction === "income" ? "text-income" : "text-expense";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="flex items-center justify-between gap-3 px-5 pt-3 md:pt-5">
        <DialogPrimitive.Title className="font-serif text-xl">{memo ? "Edit memo" : "New memo"}</DialogPrimitive.Title>
        <DialogPrimitive.Close
          render={<Button type="button" variant="ghost" size="icon" className="-mr-2 size-11 rounded-full md:size-9" aria-label="Close" />}
        >
          <X />
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pt-4 pb-5">
        <Segmented
          label="Direction"
          className="flex w-full"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "expense", label: "Expense", tone: "expense" },
            { value: "income", label: "Income", tone: "income" },
          ]}
        />

        {/* Big amount */}
        <div className="flex flex-col items-center gap-2 py-2">
          <CurrencyPicker
            value={currency}
            defaultCurrency={me?.default_currency}
            onChange={(c) => {
              setValue("currency", c);
              setValue("amount", fitAmount(getValues("amount"), c));
            }}
            triggerLabel={`Currency ${currency}, change`}
            triggerClassName="min-h-8 rounded-full bg-muted px-3 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {currency}
          </CurrencyPicker>
          <AmountField control={control} currency={currency} invalid={!!errors.amount} inputRef={amountRef} className={tone} />
          <div className="h-5 text-center text-sm" aria-live="polite">
            {errors.amount && <p className="text-destructive">{errors.amount.message}</p>}
            {!errors.amount && errors.currency && <p className="text-destructive">{errors.currency.message}</p>}
          </div>
        </div>

        {/* Category chips */}
        <fieldset className="space-y-2.5">
          <legend className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Category</legend>
          <CategoryChips
            direction={direction}
            choices={choices}
            value={categoryId}
            onChange={(id) => setValue("category_id", id)}
          />
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Date &amp; time</span>
            <Input type="datetime-local" className="h-11 rounded-xl bg-card md:h-10" aria-invalid={!!errors.occurred_at} {...register("occurred_at")} />
            {errors.occurred_at && <span className="text-sm text-destructive">{errors.occurred_at.message}</span>}
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Note</span>
            <Input placeholder="What was it for?" className="h-11 rounded-xl bg-card md:h-10" autoComplete="off" {...register("note")} />
            {errors.note && <span className="text-sm text-destructive">{errors.note.message}</span>}
          </label>
        </div>
      </div>

      {/* Outside the scroll area, so Save stays put above the keyboard / home indicator. */}
      <div className="space-y-2 border-t bg-card px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <OfflineHint className="justify-center text-xs" />
        <div className="flex gap-2">
        {memo && (
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="ghost" size="lg" className="h-11 rounded-xl px-4 text-destructive hover:bg-expense-soft hover:text-destructive" disabled={deleteMemo.isPending || !online}>
                  <Trash2 /> Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this memo?</AlertDialogTitle>
                <AlertDialogDescription>It will disappear from your ledger and totals. This can’t be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onDelete} disabled={deleteMemo.isPending || !online}>
                  {deleteMemo.isPending && <Loader2 className="animate-spin" />}
                  Delete memo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button type="submit" size="lg" className="h-11 flex-1 rounded-xl text-[0.95rem]" disabled={saving || !online}>
          {saving && <Loader2 className="animate-spin" />}
          {memo ? "Save changes" : direction === "income" ? "Save income" : "Save expense"}
        </Button>
        </div>
      </div>
    </form>
  );
}

/** The big amount field: shows the canonical form value natively grouped, re-groups as you type and keeps
 * the caret after the same digit (lib/money.ts editAmount does the work). */
function AmountField({
  control,
  currency,
  invalid,
  inputRef,
  className,
}: {
  control: Control<Values>;
  currency: string;
  invalid: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const { field } = useController({ control, name: "amount" });
  const text = formatAmountInput(field.value, currency);
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
        inputRef.current = node;
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
        // Shrinks as digits pile up so long amounts still fit a 320px-wide sheet.
        "num w-full min-w-0 bg-transparent text-center leading-none outline-none placeholder:text-muted-foreground/35",
        text.length > 11 ? "text-3xl" : text.length > 8 ? "text-4xl" : text.length > 6 ? "text-5xl" : "text-6xl",
        className,
      )}
    />
  );
}

function CategoryChips({
  direction,
  choices,
  value,
  onChange,
}: {
  direction: Direction;
  choices: { id: string; name: string; emoji: string | null }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const createCategory = useCreateCategory();
  const online = useOnline();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const c = await createCategory.mutateAsync({ name: trimmed, direction, emoji });
      onChange(c.id);
      setName("");
      setEmoji(null);
      setAdding(false);
      toast.success(`Added “${c.name}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add category");
    }
  }

  const chip =
    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 pointer-coarse:h-11 pointer-coarse:px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
        {choices.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? null : c.id)}
              className={cn(
                chip,
                active
                  ? direction === "income"
                    ? "border-income bg-income-soft text-income"
                    : "border-expense bg-expense-soft text-expense"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {c.emoji && <span aria-hidden>{c.emoji}</span>}
              {c.name}
              {active && <Check className="size-3.5" aria-hidden />}
            </button>
          );
        })}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={cn(chip, "border-dashed border-input text-muted-foreground hover:text-foreground")}>
            <Plus className="size-4" /> New
          </button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-2 rounded-2xl bg-muted/60 p-2">
          <EmojiField value={emoji} onChange={setEmoji} />
          <Input
            autoFocus
            aria-label="New category name"
            placeholder={`New ${direction} category`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
              }
            }}
            className="h-9 rounded-xl bg-card"
          />
          <Button type="button" onClick={add} disabled={!name.trim() || createCategory.isPending || !online} className="h-9 rounded-xl">
            {createCategory.isPending ? <Loader2 className="animate-spin" /> : "Add"}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Cancel new category" onClick={() => setAdding(false)}>
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
