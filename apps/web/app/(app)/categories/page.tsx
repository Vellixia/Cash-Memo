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
import { card } from "@/components/summary";
import { StarterCard } from "@/components/ledger";
import { useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory } from "@/lib/queries";
import type { Category, Direction } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function CategoriesPage() {
  const [direction, setDirection] = useState<Direction>("expense");
  const { data: categories, isLoading } = useCategories();
  const list = categories?.filter((c) => c.direction === direction) ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Categories</h1>
        <p className="text-sm text-muted-foreground">Give each kind of money a name and an emoji.</p>
      </header>

      {categories?.length === 0 && <StarterCard />}

      <Segmented
        label="Category type"
        className="flex w-full sm:w-72"
        value={direction}
        onChange={setDirection}
        options={[
          { value: "expense", label: "Expense", tone: "expense" },
          { value: "income", label: "Income", tone: "income" },
        ]}
      />

      <AddCategory direction={direction} />

      {isLoading ? (
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
    </div>
  );
}

function AddCategory({ direction }: { direction: Direction }) {
  const create = useCreateCategory();
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
        <EmojiField value={emoji} onChange={setEmoji} className="size-11 rounded-2xl" />
        <Input
          aria-label="Category name"
          aria-invalid={!!error}
          placeholder={`New ${direction} category`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="h-11 rounded-2xl bg-card px-4"
        />
        <Button type="submit" className="h-11 rounded-2xl px-4" disabled={create.isPending}>
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
          <Button type="submit" size="icon" className="size-10 rounded-xl" aria-label="Save category" disabled={update.isPending}>
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
        className="size-10 rounded-2xl border-transparent bg-muted"
      />
      <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-xl text-muted-foreground"
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
          render={<Button variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground hover:text-destructive" aria-label={`Delete ${category.name}`} />}
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
            <AlertDialogAction variant="destructive" onClick={onDelete} disabled={remove.isPending}>
              {remove.isPending && <Loader2 className="animate-spin" />}
              Delete category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
