"use client";

import { useState } from "react";
import { Check, Ellipsis, Loader2, Pencil, PiggyBank, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmojiField } from "@/components/emoji-field";
import { Segmented } from "@/components/segmented";
import { OfflineHint } from "@/components/offline-hint";
import { useOnline } from "@/lib/use-online";
import { card } from "@/components/summary";
import { StarterCard } from "@/components/ledger";
import { useBudgets, useCategories, useCreateCategory, useDeleteBudget, useDeleteCategory, useMe, useSaveBudget, useUpdateCategory } from "@/lib/queries";
import type { Budget, Category, Direction } from "@/lib/api";
import { currentMonth } from "@/lib/format";
import { formatMoney, fromMinor, parseAmount, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

const DIRECTIONS: Direction[] = ["expense", "income"];
const TITLE = { expense: "Expense", income: "Income" } as const;

export function CategoriesPanel() {
  const [direction, setDirection] = useState<Direction>("expense");
  const { data: categories, isLoading } = useCategories();
  const { data: budgets } = useBudgets(currentMonth());
  // Budgets are set in the default currency (the API allows one per currency).
  const currency = useMe().data?.default_currency ?? "USD";

  return (
    <div className="space-y-6">
      {categories?.length === 0 && <StarterCard />}
      <OfflineHint className="rounded-2xl bg-muted px-4 py-3" />

      {/* Tabs below `lg`; from `lg` both lists sit side by side and the tabs go away. */}
      <Segmented
        label="Category type"
        className="flex w-full sm:w-72 lg:hidden"
        value={direction}
        onChange={setDirection}
        options={[
          { value: "expense", label: "Expense", tone: "expense" },
          { value: "income", label: "Income", tone: "income" },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
        {DIRECTIONS.map((d) => (
          <CategoryList
            key={d}
            direction={d}
            list={categories?.filter((c) => c.direction === d) ?? []}
            loading={isLoading}
            className={d === direction ? undefined : "hidden lg:block"}
            budgets={d === "expense" ? (budgets ?? []) : undefined}
            currency={currency}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryList({
  direction,
  list,
  loading,
  className,
  budgets,
  currency,
}: {
  direction: Direction;
  list: Category[];
  loading: boolean;
  className?: string;
  /** Expense lists only. */
  budgets?: Budget[];
  currency: string;
}) {
  return (
    <section aria-label={`${TITLE[direction]} categories`} className={cn("space-y-4", className)}>
      <h2 className="hidden items-center gap-2 font-serif text-xl lg:flex">
        <span className={cn("size-2.5 rounded-full", direction === "income" ? "bg-income" : "bg-expense")} aria-hidden />
        {TITLE[direction]}
        <span className="text-sm font-normal text-muted-foreground tabular-nums">{list.length || ""}</span>
      </h2>
      <AddCategory direction={direction} />
      {loading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : list.length === 0 ? (
        <p className={cn(card, "rounded-2xl px-5 py-8 text-center text-sm text-muted-foreground")}>No {direction} categories yet. Add one above.</p>
      ) : (
        <ul className={cn(card, "divide-y divide-border/70 overflow-hidden rounded-2xl")} aria-label={`${direction} categories`}>
          {list.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              currency={currency}
              budget={budgets && (budgets.find((b) => b.category_id === c.id && b.currency === currency) ?? null)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddCategory({ direction }: { direction: Direction }) {
  const create = useCreateCategory();
  const online = useOnline();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Give it a name");
    if (trimmed.length > 80) return setError("Keep it under 80 characters");
    try {
      await create.mutateAsync({ name: trimmed, direction, emoji });
      toast.success(`Added “${trimmed}”`);
      setName("");
      setEmoji(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add category");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1.5" noValidate>
      <div className="flex items-center gap-2">
        <EmojiField value={emoji} onChange={setEmoji} label={`Choose emoji for new ${direction} category`} className="size-11 rounded-2xl" />
        <Input
          aria-label={`New ${direction} category name`}
          aria-invalid={!!error}
          placeholder={`New ${direction} category`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="h-11 rounded-2xl bg-card px-4"
        />
        <Button type="submit" className="h-11 rounded-2xl px-4" disabled={create.isPending || !online}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add
        </Button>
      </div>
      {error && (
        <p role="alert" className="pl-14 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function CategoryRow({ category, budget, currency }: { category: Category; budget?: Budget | null; currency: string }) {
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState<string | null>(category.emoji);
  const [confirm, setConfirm] = useState(false);
  const [budgeting, setBudgeting] = useState(false);

  async function save(patch: { name?: string; emoji?: string | null }, done?: () => void) {
    try {
      await update.mutateAsync({ id: category.id, patch });
      toast.success("Category updated");
      done?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update category");
    }
  }

  async function onDelete() {
    try {
      await remove.mutateAsync(category.id);
      setConfirm(false);
      toast.success(`Deleted “${category.name}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete category");
    }
  }

  if (editing) {
    return (
      <li>
        <form
          className="flex items-center gap-2 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return toast.error("Name can’t be empty");
            save({ name: trimmed, emoji }, () => setEditing(false));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
        >
          <EmojiField value={emoji} onChange={setEmoji} label={`Emoji for ${category.name}`} className="size-10 rounded-2xl" />
          <Input autoFocus aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-xl bg-card" />
          <Button type="submit" size="icon" className="size-10 rounded-xl" aria-label="Save category" disabled={update.isPending || !online}>
            {update.isPending ? <Loader2 className="animate-spin" /> : <Check />}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-10 rounded-xl" aria-label="Cancel editing" onClick={() => setEditing(false)}>
            <X />
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5" data-testid="category-row">
      {/* Picking an emoji saves straight away; no edit mode needed. */}
      <EmojiField
        value={category.emoji}
        onChange={(e) => save({ emoji: e })}
        label={`Change emoji for ${category.name}`}
        disabled={!online}
        className="size-10 shrink-0 rounded-2xl border-transparent bg-muted"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{category.name}</span>
        {budget && <LimitStatus budget={budget} name={category.name} />}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 rounded-xl text-muted-foreground md:size-9"
              aria-label={`Actions for ${category.name}`}
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48 rounded-xl p-1.5">
          <DropdownMenuItem
            className="px-2 py-1.5"
            onClick={() => {
              setName(category.name);
              setEmoji(category.emoji);
              setEditing(true);
            }}
          >
            <Pencil /> Rename
          </DropdownMenuItem>
          {/* Monthly limits are for expense categories only. */}
          {budget !== undefined && (
            <DropdownMenuItem className="px-2 py-1.5" onClick={() => setBudgeting(true)}>
              <PiggyBank /> {budget ? "Edit monthly limit" : "Set monthly limit"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="px-2 py-1.5" onClick={() => setConfirm(true)} disabled={!online}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{category.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Memos in this category stay in your ledger, just without a category.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete} disabled={remove.isPending || !online}>
              {remove.isPending && <Loader2 className="animate-spin" />}
              Delete category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {budgeting && <LimitDialog category={category} budget={budget ?? null} currency={currency} onClose={() => setBudgeting(false)} />}
    </li>
  );
}

/** This month against the limit: spent of limit, what's left, and a warning when recurring expenses will push it over. */
function LimitStatus({ budget, name }: { budget: Budget; name: string }) {
  const { limit_minor: limit, spent_minor: spent, projected_minor: projected, currency } = budget;
  const left = limit - spent;
  // Same thresholds as the Home budgets card: amber from 80%, red once reached.
  const tone = spent >= limit ? "bg-expense" : spent >= limit * 0.8 ? "bg-amber-500" : "bg-income";
  return (
    <span className="mt-1 block space-y-1" data-testid="limit-status">
      <span className="num block truncate text-xs text-muted-foreground">
        {formatMoney(spent, currency)} of {formatMoney(limit, currency)} this month
      </span>
      <span
        role="progressbar"
        aria-label={`${name} monthly limit`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((spent / limit) * 100)}
        className="relative block h-1.5 max-w-64 overflow-hidden rounded-full bg-muted"
      >
        <span className={cn("absolute inset-y-0 left-0 rounded-full opacity-35", tone)} style={{ width: `${Math.min(projected / limit, 1) * 100}%` }} />
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.min(spent / limit, 1) * 100}%` }} />
      </span>
      <span className="num flex flex-wrap gap-x-2 text-xs">
        {left >= 0 ? (
          <span className="text-muted-foreground">{formatMoney(left, currency)} remaining</span>
        ) : (
          <span className="text-expense">{formatMoney(-left, currency)} over</span>
        )}
        {left >= 0 && projected > limit && (
          <span className="text-amber-700 dark:text-amber-400">Recurring expenses will take it {formatMoney(projected - limit, currency)} over</span>
        )}
      </span>
    </span>
  );
}

/** Set, change or remove a category's monthly limit. */
function LimitDialog({ category, budget, currency, onClose }: { category: Category; budget: Budget | null; currency: string; onClose: () => void }) {
  const save = useSaveBudget();
  const remove = useDeleteBudget();
  const online = useOnline();
  const [limit, setLimit] = useState(budget ? fromMinor(budget.limit_minor, currency) : "");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const limit_minor = toMinor(parseAmount(limit, currency), currency);
    if (!(limit_minor > 0)) return setError("Enter a monthly limit above zero");
    try {
      await save.mutateAsync({ id: budget?.id, category_id: category.id, currency, limit_minor });
      toast.success(`Monthly limit set for “${category.name}”`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the limit");
    }
  }

  async function onRemove() {
    if (!budget) return;
    try {
      await remove.mutateAsync(budget.id);
      toast.success(`Monthly limit removed from “${category.name}”`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the limit");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="rounded-2xl sm:max-w-md">
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="font-serif text-xl leading-tight">
              {category.emoji && <span aria-hidden>{category.emoji} </span>}
              Monthly limit for {category.name}
            </DialogTitle>
            <DialogDescription>Optional. See how each month compares, with a heads-up on Home as spending gets close.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={`limit-${category.id}`} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Monthly limit ({currency})
            </label>
            <Input
              id={`limit-${category.id}`}
              autoFocus
              inputMode="decimal"
              aria-invalid={!!error}
              aria-describedby={`limit-${category.id}-hint`}
              placeholder={fromMinor(0, currency)}
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value);
                setError(null);
              }}
              className="h-11 rounded-xl bg-card px-3.5 text-base"
            />
            <p id={`limit-${category.id}-hint`} className="text-xs text-muted-foreground">
              Limits use your default currency, {currency}. Change it in Settings.
              {budget && ` ${formatMoney(budget.spent_minor, currency)} spent so far this month.`}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            {budget && (
              <Button
                type="button"
                variant="ghost"
                className="h-10 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
                onClick={onRemove}
                disabled={remove.isPending || !online}
              >
                {remove.isPending && <Loader2 className="animate-spin" />}
                Remove limit
              </Button>
            )}
            <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-10 rounded-xl" disabled={save.isPending || !online}>
              {save.isPending && <Loader2 className="animate-spin" />}
              Save limit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
