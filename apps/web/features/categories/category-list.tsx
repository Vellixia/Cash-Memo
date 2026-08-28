"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListCategoriesQueryKey, getListRecurringTransactionsQueryKey, useArchiveCategory, useDeleteCategory, useListCategories, useRestoreCategory } from "../../generated/api";
import type { CategoryContract } from "../../generated/api/model/categoryContract";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { CategoryForm } from "./category-form";

function errorText(error: unknown): string {
  const value = error as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function CategoryList() {
  const client = useQueryClient();
  const categories = useListCategories({ query: { retry: 1 } });
  const archive = useArchiveCategory();
  const restore = useRestoreCategory();
  const remove = useDeleteCategory();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CategoryContract>();
  const [formOpen, setFormOpen] = useState(false);
  const [archiving, setArchiving] = useState<CategoryContract>();
  const [deleting, setDeleting] = useState<CategoryContract>();
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const list = (categories.data?.data ?? []).filter((category) => category.kind === kind && (showArchived || !category.archived_at));

  async function invalidateCategory() { await client.invalidateQueries({ queryKey: getListCategoriesQueryKey() }); }
  async function archiveCategory(category: CategoryContract) {
    setStatus(undefined);
    try {
      const response = await archive.mutateAsync({ categoryId: category.id });
      await Promise.all([invalidateCategory(), client.invalidateQueries({ queryKey: getListRecurringTransactionsQueryKey() })]);
      const count = response.data.paused_recurring_count;
      setArchiving(undefined);
      setStatus({ kind: "success", text: count > 0 ? `Category archived. ${String(count)} recurring ${count === 1 ? "rule" : "rules"} paused.` : "Category archived." });
    } catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  async function restoreCategory(category: CategoryContract) {
    setStatus(undefined);
    try { await restore.mutateAsync({ categoryId: category.id }); await invalidateCategory(); setStatus({ kind: "success", text: "Category restored. Recurring rules stay paused until you resume them." }); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  async function deleteCategory(category: CategoryContract) {
    setStatus(undefined);
    try { await remove.mutateAsync({ categoryId: category.id }); setDeleting(undefined); setDeleteErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== category.id))); await invalidateCategory(); setStatus({ kind: "success", text: "Category deleted." }); }
    catch (error) { setDeleting(undefined); const message = `Category cannot be deleted while it has references. ${errorText(error)}`; setDeleteErrors((current) => ({ ...current, [category.id]: message })); }
  }

  if (categories.isPending) return <p className="loading-state" aria-live="polite">Loading categories…</p>;
  if (categories.isError) return <section><h1>Categories</h1><p role="alert" className="field-error">Could not load categories.</p><Button type="button" onClick={() => void categories.refetch()}>Retry</Button></section>;

  return <section className="management-page">
    <div className="page-heading"><div><p className="muted">Flat labels</p><h1>Categories</h1></div><Button type="button" onClick={() => { setEditing(undefined); setFormOpen(true); }}>Create category</Button></div>
    <p className="muted">Income and expense categories share one flat list. Archive keeps history and pauses dependent recurring rules.</p>
    <Tabs value={kind} onValueChange={(value) => setKind(value as "expense" | "income")}><TabsList aria-label="Category kind"><TabsTrigger value="expense">Expense</TabsTrigger><TabsTrigger value="income">Income</TabsTrigger></TabsList></Tabs>
    <label className="archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
    {status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
    <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="management-dialog"><DialogHeader><DialogTitle>{editing ? "Rename category" : "Create category"}</DialogTitle><DialogDescription>{editing ? "Renaming changes how this label appears across history." : "Income and expense categories stay separate."}</DialogDescription></DialogHeader><CategoryForm category={editing} defaultKind={kind} showHeading={false} onCancel={() => setFormOpen(false)} onSuccess={() => { setFormOpen(false); setEditing(undefined); void invalidateCategory(); }} /></DialogContent></Dialog>
    {list.length === 0 ? <div className="empty-state"><h2>No {showArchived ? kind : `active ${kind}`} categories</h2><p>{showArchived ? "Create a category to organize entries." : "Archived categories are hidden. Turn on Show archived to manage them."}</p><Button type="button" onClick={() => { setEditing(undefined); setFormOpen(true); }}>Create category</Button></div> : <div className="card-list">{list.map((category) => { const archived = Boolean(category.archived_at); return <article className={`management-card management-row ${archived ? "is-archived" : ""}`} key={category.id}><div><h2>{category.name}</h2><p className="muted"><span className="status-label">{archived ? "Archived" : "Active"}</span> · {category.kind === "income" ? "Income" : "Expense"}</p>{deleteErrors[category.id] ? <p role="alert" className="field-error">{deleteErrors[category.id]}</p> : null}</div><DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="quiet" aria-label={`Actions for ${category.name}`}>Actions</Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { setEditing(category); setFormOpen(true); }}>Rename</DropdownMenuItem>{archived ? <DropdownMenuItem onClick={() => void restoreCategory(category)} disabled={restore.isPending}>Restore</DropdownMenuItem> : <DropdownMenuItem onClick={() => setArchiving(category)}>Archive</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleting(category)}>Delete forever</DropdownMenuItem></DropdownMenuContent></DropdownMenu></article>; })}</div>}
    <Dialog open={Boolean(archiving)} onOpenChange={(open) => { if (!open) setArchiving(undefined); }}><DialogContent><DialogHeader><DialogTitle>Archive {archiving?.name}?</DialogTitle><DialogDescription>Archiving keeps history, removes this category from new entries, and pauses dependent recurring rules. Restore will not resume those rules.</DialogDescription></DialogHeader><div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setArchiving(undefined)}>Cancel</Button><Button type="button" variant="danger" onClick={() => archiving && void archiveCategory(archiving)} disabled={archive.isPending}>{archive.isPending ? "Archiving…" : "Archive category"}</Button></div></DialogContent></Dialog>
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(undefined); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete category forever?</AlertDialogTitle><AlertDialogDescription>Delete {deleting?.name} permanently? This is allowed only when no history references this category. The server decides whether deletion can proceed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="danger" onClick={() => deleting && void deleteCategory(deleting)} disabled={remove.isPending} aria-busy={remove.isPending}>{remove.isPending ? "Deleting…" : "Delete forever"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
