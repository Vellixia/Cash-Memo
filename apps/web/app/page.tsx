"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SummaryCards } from "@/components/summary-cards";
import { CategoryBars } from "@/components/category-bars";
import { MemoList } from "@/components/memo-list";
import MemoForm from "@/components/MemoForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCategories, useMemos, useSummary } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import type { Memo } from "@/lib/api";

export default function HomePage() {
  const month = useUiStore((s) => s.month);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [dialog, setDialog] = useState<"new" | Memo | null>(null);

  const { data: memos, isLoading: memosLoading } = useMemos(month, categoryFilter);
  const { data: summary, isLoading: summaryLoading } = useSummary(month);
  const { data: categories = [] } = useCategories();

  const expenseCategoryIds = new Set(
    (summary?.by_category ?? []).filter((c) => c.direction === "expense" && c.category_id).map((c) => c.category_id),
  );
  const filterableCategories = categories.filter((c) => expenseCategoryIds.has(c.id));

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
        {summaryLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <SummaryCards totals={summary?.totals ?? []} />
        )}

        {summaryLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <CategoryBars byCategory={summary?.by_category ?? []} categories={categories} />
        )}

        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Memos</h2>
          <Button size="sm" onClick={() => setDialog("new")} className="hidden sm:inline-flex">
            <Plus /> New memo
          </Button>
        </div>

        {filterableCategories.length > 0 && (
          <div className="-mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter(undefined)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                categoryFilter === undefined ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              All
            </button>
            {filterableCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryFilter(c.id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  categoryFilter === c.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {memosLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <MemoList memos={memos ?? []} categories={categories} onSelect={(m) => setDialog(m)} />
        )}
      </main>

      <Button
        size="icon-lg"
        onClick={() => setDialog("new")}
        aria-label="New memo"
        className="fixed bottom-5 right-5 size-14 rounded-full shadow-lg sm:hidden"
      >
        <Plus className="size-6" />
      </Button>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === "new" ? "New memo" : "Edit memo"}</DialogTitle>
          </DialogHeader>
          {dialog !== null && (
            <MemoForm memo={dialog === "new" ? undefined : dialog} onSaved={() => setDialog(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
