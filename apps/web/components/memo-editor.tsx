"use client";

import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
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
import { fromMinor, toMinor, type Direction, type Memo } from "@/lib/api";
import { toDatetimeLocal } from "@/lib/format";
import { useCategories, useCreateCategory, useCreateMemo, useDeleteMemo, useUpdateMemo } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    direction: z.enum(["expense", "income"]),
    amount: z
      .string()
      .trim()
      .min(1, "Enter an amount")
      .regex(/^\d+([.,]\d*)?$|^[.,]\d+$/, "Enter a number like 12.50"),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use a 3-letter code like USD"),
    occurred_at: z.string().min(1, "Pick a date and time"),
    category_id: z.string().nullable(),
    note: z.string().max(2000, "Keep notes under 2000 characters"),
  })
  .superRefine((v, ctx) => {
    if (/^[A-Za-z]{3}$/.test(v.currency) && /\d/.test(v.amount) && toMinor(v.amount.replace(",", "."), v.currency.toUpperCase()) <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero" });
    }
  });
type Values = z.infer<typeof schema>;

/** Add/edit memo: a bottom sheet on phones, a centered dialog from `md` up (same element, CSS only). */
export function MemoEditor() {
  const open = useUiStore((s) => s.editorOpen);
  const editing = useUiStore((s) => s.editing);
  const editorKey = useUiStore((s) => s.editorKey);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const amountRef = useRef<HTMLInputElement | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && closeEditor()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[#1c1b19]/25 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        <DialogPrimitive.Popup
          initialFocus={amountRef}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[1.75rem] bg-card text-card-foreground shadow-2xl ring-1 ring-border outline-none",
            "transition-[translate,opacity,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-y-full data-starting-style:translate-y-full",
            "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[90dvh] md:w-[28rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.75rem] md:duration-200",
            "md:data-ending-style:-translate-y-1/2 md:data-ending-style:scale-95 md:data-ending-style:opacity-0 md:data-starting-style:-translate-y-1/2 md:data-starting-style:scale-95 md:data-starting-style:opacity-0",
          )}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border md:hidden" aria-hidden />
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
  const lastCurrency = useUiStore((s) => s.lastCurrency);
  const setLastCurrency = useUiStore((s) => s.setLastCurrency);
  const { data: categories = [] } = useCategories();
  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();
  const deleteMemo = useDeleteMemo();
  const [editingCurrency, setEditingCurrency] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: memo?.direction ?? "expense",
      amount: memo ? fromMinor(memo.amount_minor, memo.currency) : "",
      currency: memo?.currency ?? lastCurrency,
      occurred_at: toDatetimeLocal(memo ? new Date(memo.occurred_at) : new Date()),
      category_id: memo?.category_id ?? null,
      note: memo?.note ?? "",
    },
  });

  const [direction, currency, categoryId] = useWatch({ control, name: ["direction", "currency", "category_id"] });
  const choices = categories.filter((c) => c.direction === direction);
  const saving = createMemo.isPending || updateMemo.isPending;
  const { ref: amountFieldRef, ...amountField } = register("amount");

  function setDirection(d: Direction) {
    setValue("direction", d);
    const current = categories.find((c) => c.id === categoryId);
    if (current && current.direction !== d) setValue("category_id", null);
  }

  async function onSubmit(values: Values) {
    const cur = values.currency.toUpperCase();
    const body = {
      direction: values.direction,
      amount_minor: toMinor(values.amount.replace(",", "."), cur),
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
      setLastCurrency(cur);
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
          render={<Button type="button" variant="ghost" size="icon" className="-mr-2 rounded-full" aria-label="Close" />}
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
          <div className="flex items-baseline justify-center gap-2">
            {editingCurrency ? (
              <input
                aria-label="Currency code"
                autoFocus
                maxLength={3}
                autoComplete="off"
                className="w-16 rounded-full border border-input bg-card px-2 py-1 text-center text-sm font-semibold tracking-wider uppercase outline-none focus:ring-3 focus:ring-ring/40"
                {...register("currency", {
                  onBlur: () => setEditingCurrency(false),
                })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setEditingCurrency(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingCurrency(true)}
                aria-label={`Currency ${currency.toUpperCase()}, change`}
                className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase transition-colors hover:bg-accent hover:text-foreground"
              >
                {currency.toUpperCase() || "—"}
              </button>
            )}
          </div>
          <input
            {...amountField}
            ref={(el) => {
              amountFieldRef(el);
              amountRef.current = el;
            }}
            aria-label="Amount"
            aria-invalid={!!errors.amount}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className={cn(
              "num w-full bg-transparent text-center text-6xl leading-none outline-none placeholder:text-muted-foreground/35",
              tone,
            )}
          />
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
            <Input type="datetime-local" className="h-10 rounded-xl bg-card" aria-invalid={!!errors.occurred_at} {...register("occurred_at")} />
            {errors.occurred_at && <span className="text-sm text-destructive">{errors.occurred_at.message}</span>}
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Note</span>
            <Input placeholder="What was it for?" className="h-10 rounded-xl bg-card" autoComplete="off" {...register("note")} />
            {errors.note && <span className="text-sm text-destructive">{errors.note.message}</span>}
          </label>
        </div>
      </div>

      <div className="flex gap-2 border-t bg-card px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {memo && (
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="ghost" size="lg" className="h-11 rounded-xl px-4 text-destructive hover:bg-expense-soft hover:text-destructive" disabled={deleteMemo.isPending}>
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
                <AlertDialogAction variant="destructive" onClick={onDelete} disabled={deleteMemo.isPending}>
                  {deleteMemo.isPending && <Loader2 className="animate-spin" />}
                  Delete memo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button type="submit" size="lg" className="h-11 flex-1 rounded-xl text-[0.95rem]" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          {memo ? "Save changes" : direction === "income" ? "Save income" : "Save expense"}
        </Button>
      </div>
    </form>
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
    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

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
          <Button type="button" onClick={add} disabled={!name.trim() || createCategory.isPending} className="h-9 rounded-xl">
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
