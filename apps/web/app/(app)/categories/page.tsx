"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmojiField } from "@/components/emoji-field";
import { Segmented } from "@/components/segmented";
import { OfflineHint } from "@/components/offline-hint";
import { useOnline } from "@/lib/use-online";
import { card } from "@/components/summary";
import { StarterCard } from "@/components/ledger";
import { useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory } from "@/lib/queries";
import type { Category, Direction } from "@/lib/api";
import { cn } from "@/lib/utils";

const DIRECTIONS: Direction[] = ["expense", "income"];
const TITLE = { expense: "Expense", income: "Income" } as const;

export default function CategoriesPage() {
  const [direction, setDirection] = useState<Direction>("expense");
  const { data: categories, isLoading } = useCategories();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Categories</h1>
        <p className="text-sm text-muted-foreground">Give each kind of money a name and an emoji.</p>
      </header>

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

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        {DIRECTIONS.map((d) => (
          <CategoryList
            key={d}
            direction={d}
            list={categories?.filter((c) => c.direction === d) ?? []}
            loading={isLoading}
            className={d === direction ? undefined : "hidden lg:block"}
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
}: {
  direction: Direction;
  list: Category[];
  loading: boolean;
  className?: string;
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
            <CategoryRow key={c.id} category={c} />
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

function CategoryRow({ category }: { category: Category }) {
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState<string | null>(category.emoji);
  const [confirm, setConfirm] = useState(false);

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
        className="size-10 rounded-2xl border-transparent bg-muted"
      />
      <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-xl text-muted-foreground md:size-9"
        aria-label={`Rename ${category.name}`}
        onClick={() => {
          setName(category.name);
          setEmoji(category.emoji);
          setEditing(true);
        }}
      >
        <Pencil />
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-11 rounded-xl text-muted-foreground hover:text-destructive md:size-9"
              aria-label={`Delete ${category.name}`}
              disabled={!online}
            />
          }
        >
          <Trash2 />
        </AlertDialogTrigger>
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
    </li>
  );
}
