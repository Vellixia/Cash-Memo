"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory } from "@/lib/queries";
import type { Category, Direction } from "@/lib/api";

const nameSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(80) });

function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: category.name },
  });

  async function onRename(values: { name: string }) {
    try {
      await updateCategory.mutateAsync({ id: category.id, name: values.name.trim() });
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename category");
    }
  }

  async function onDelete() {
    try {
      await deleteCategory.mutateAsync(category.id);
      toast.success("Category deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete category");
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSubmit(onRename)}
        className="flex items-center gap-2 rounded-lg border px-3 py-2"
      >
        <Input autoFocus className="h-8" {...register("name")} />
        <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save" disabled={updateCategory.isPending}>
          <Check />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Cancel"
          onClick={() => {
            reset({ name: category.name });
            setEditing(false);
          }}
        >
          <X />
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="truncate text-sm">{category.name}</span>
      <div className="flex shrink-0 gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="Rename" onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button size="icon-sm" variant="ghost" aria-label="Delete">
                <Trash2 />
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{category.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                Existing memos keep their amounts but lose this category.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function CategoryTab({ direction, categories }: { direction: Direction; categories: Category[] }) {
  const createCategory = useCreateCategory();
  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: "" },
  });

  async function onCreate(values: { name: string }) {
    try {
      await createCategory.mutateAsync({ name: values.name.trim(), direction });
      reset({ name: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add category");
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit(onCreate)} className="flex gap-2">
        <Input placeholder={`New ${direction} category`} {...register("name")} />
        <Button type="submit" disabled={createCategory.isPending}>
          <Plus /> Add
        </Button>
      </form>
      <div className="space-y-1.5">
        {categories.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No {direction} categories yet.
          </p>
        )}
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}
      </div>
    </div>
  );
}

export default function CategoriesPage() {
  const { data: categories, isLoading } = useCategories();

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-6">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back
        </Link>
        <h1 className="text-xl font-semibold">Categories</h1>

        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <Tabs defaultValue="expense">
            <TabsList>
              <TabsTrigger value="expense">Expense</TabsTrigger>
              <TabsTrigger value="income">Income</TabsTrigger>
            </TabsList>
            <TabsContent value="expense" className="pt-3">
              <CategoryTab direction="expense" categories={(categories ?? []).filter((c) => c.direction === "expense")} />
            </TabsContent>
            <TabsContent value="income" className="pt-3">
              <CategoryTab direction="income" categories={(categories ?? []).filter((c) => c.direction === "income")} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </>
  );
}
