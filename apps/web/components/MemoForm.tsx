"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toMinor, fromMinor, type Direction, type Memo } from "@/lib/api";
import { useCategories, useCreateCategory, useCreateMemo, useDeleteMemo, useUpdateMemo } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { toast } from "sonner";

const NO_CATEGORY = "none";
const NEW_CATEGORY = "__new__";

const memoSchema = z.object({
  direction: z.enum(["expense", "income"]),
  amount: z
    .string()
    .min(1, "Amount is required")
    .regex(/^\d+(\.\d+)?$/, "Enter a positive number"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "3-letter code (e.g. USD)"),
  occurred_at: z.string().min(1, "Required"),
  category_id: z.string(),
  note: z.string().max(2000).optional(),
});
type MemoFormValues = z.infer<typeof memoSchema>;

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default function MemoForm({ memo, onSaved }: { memo?: Memo; onSaved?: () => void }) {
  const isEdit = !!memo;
  const lastCurrency = useUiStore((s) => s.lastCurrency);
  const setLastCurrency = useUiStore((s) => s.setLastCurrency);
  const { data: categories = [] } = useCategories();
  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();
  const deleteMemo = useDeleteMemo();
  const createCategory = useCreateCategory();

  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<MemoFormValues>({
    resolver: zodResolver(memoSchema),
    defaultValues: {
      direction: memo?.direction ?? "expense",
      amount: memo ? fromMinor(memo.amount_minor, memo.currency) : "",
      currency: memo?.currency ?? lastCurrency,
      occurred_at: memo ? toDatetimeLocal(new Date(memo.occurred_at)) : toDatetimeLocal(new Date()),
      category_id: memo?.category_id ?? NO_CATEGORY,
      note: memo?.note ?? "",
    },
  });

  const direction = watch("direction");
  const filteredCategories = categories.filter((c) => c.direction === direction);
  const saving = createMemo.isPending || updateMemo.isPending || deleteMemo.isPending;

  async function onSubmit(values: MemoFormValues) {
    const currency = values.currency.toUpperCase();
    const body = {
      direction: values.direction as Direction,
      amount_minor: toMinor(values.amount, currency),
      currency,
      occurred_at: new Date(values.occurred_at).toISOString(),
      category_id: values.category_id === NO_CATEGORY ? null : values.category_id,
      note: values.note?.trim() ? values.note.trim() : null,
    };

    try {
      if (isEdit) {
        await updateMemo.mutateAsync({ id: memo.id, input: body });
        toast.success("Memo updated");
      } else {
        await createMemo.mutateAsync(body);
        toast.success("Memo added");
      }
      setLastCurrency(currency);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save memo");
    }
  }

  async function onDelete() {
    if (!memo) return;
    try {
      await deleteMemo.mutateAsync(memo.id);
      toast.success("Memo deleted");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete memo");
    }
  }

  async function onCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      const category = await createCategory.mutateAsync({ name, direction });
      setValue("category_id", category.id);
      setNewCategoryName("");
      setCreatingCategory(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add category");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field>
        <FieldLabel>Direction</FieldLabel>
        <div className="flex gap-2">
          {(["expense", "income"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setValue("direction", d)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                direction === d
                  ? d === "income"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                    : "border-rose-600 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                  : "border-input text-muted-foreground hover:bg-muted"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <Field data-invalid={!!errors.amount}>
          <FieldLabel htmlFor="amount">Amount</FieldLabel>
          <div className="flex items-center rounded-lg border border-input bg-transparent pl-3 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
              {watch("currency")?.toUpperCase() || "USD"}
            </span>
            <Input
              id="amount"
              inputMode="decimal"
              placeholder="0.00"
              className="border-0 text-lg tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
              {...register("amount")}
            />
          </div>
          <FieldError errors={[errors.amount]} />
        </Field>

        <Field data-invalid={!!errors.currency}>
          <FieldLabel htmlFor="currency">Currency</FieldLabel>
          <Input id="currency" maxLength={3} className="uppercase" {...register("currency")} />
          <FieldError errors={[errors.currency]} />
        </Field>
      </div>

      <Field data-invalid={!!errors.occurred_at}>
        <FieldLabel htmlFor="occurred_at">Date &amp; time</FieldLabel>
        <Input id="occurred_at" type="datetime-local" {...register("occurred_at")} />
        <FieldError errors={[errors.occurred_at]} />
      </Field>

      <Field>
        <FieldLabel htmlFor="category">Category</FieldLabel>
        <Controller
          control={control}
          name="category_id"
          render={({ field }) => (
            <Select
              value={field.value}
              items={{
                [NO_CATEGORY]: "No category",
                ...Object.fromEntries(filteredCategories.map((c) => [c.id, c.name])),
              }}
              onValueChange={(value) => {
                if (value === NEW_CATEGORY) {
                  setCreatingCategory(true);
                  return;
                }
                field.onChange(value);
              }}
            >
              <SelectTrigger id="category" className="w-full">
                <SelectValue placeholder="No category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>No category</SelectItem>
                {filteredCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_CATEGORY}>
                  <Plus className="size-3.5" /> New category
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        {creatingCategory && (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder={`New ${direction} category`}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCreateCategory();
                }
              }}
            />
            <Button type="button" size="sm" onClick={onCreateCategory} disabled={createCategory.isPending}>
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreatingCategory(false)}>
              Cancel
            </Button>
          </div>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="note">Note</FieldLabel>
        <textarea
          id="note"
          rows={3}
          placeholder="Optional"
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30"
          {...register("note")}
        />
      </Field>

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={saving} className="flex-1">
          {saving && <Loader2 className="animate-spin" />}
          {isEdit ? "Save changes" : "Add memo"}
        </Button>
        {isEdit && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="destructive" disabled={saving}>
                  <Trash2 />
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this memo?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </form>
  );
}
