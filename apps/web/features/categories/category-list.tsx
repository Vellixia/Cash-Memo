"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListCategoriesQueryKey,
  useArchiveCategory,
  useDeleteCategory,
  useListCategories,
  useRestoreCategory,
} from "../../generated/api";
import type { CategoryContract } from "../../generated/api/model/categoryContract";
import { Button } from "../../components/ui/button";
import { CategoryForm } from "./category-form";

function errorText(error: unknown): string {
  const value = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function CategoryList() {
  const queryClient = useQueryClient();
  const categories = useListCategories({ query: { retry: 1 } });
  const archive = useArchiveCategory();
  const restore = useRestoreCategory();
  const remove = useDeleteCategory();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [editing, setEditing] = useState<CategoryContract>();
  const [showForm, setShowForm] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const list = (categories.data?.data ?? []).filter((category) => category.kind === kind);

  async function refresh() { await queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() }); }
  async function archiveCategory(id: string) {
    setStatus(undefined);
    try { const response = await archive.mutateAsync({ categoryId: id }); const count = response.data.paused_recurring_count; setStatus({ kind: "success", text: count > 0 ? `Category archived. ${String(count)} recurring ${count === 1 ? "rule" : "rules"} paused.` : "Category archived." }); setConfirming(undefined); await refresh(); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  async function restoreCategory(id: string) {
    setStatus(undefined);
    try { await restore.mutateAsync({ categoryId: id }); setStatus({ kind: "success", text: "Category restored. Recurring rules stay paused until you resume them." }); await refresh(); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  async function deleteCategory(id: string) {
    setStatus(undefined);
    try { await remove.mutateAsync({ categoryId: id }); setDeleting(undefined); setStatus({ kind: "success", text: "Category deleted." }); await refresh(); }
    catch (error) { setDeleting(undefined); setStatus({ kind: "error", text: `Category cannot be deleted while it has references. ${errorText(error)}` }); }
  }

  if (categories.isPending) return <p className="loading-state" aria-live="polite">Loading categories…</p>;
  if (categories.isError) return <section><h1>Categories</h1><p role="alert" className="field-error">Could not load categories.</p><Button type="button" onClick={() => void categories.refetch()}>Retry</Button></section>;

  return <section className="management-page">
    <div className="page-heading"><div><p className="muted">Flat labels</p><h1>Categories</h1></div><Button type="button" onClick={() => { setEditing(undefined); setShowForm(true); }}>Create category</Button></div>
    <p className="muted">Seeded and custom categories work the same. Rename changes historical labels; archive keeps history.</p>
    <div className="tabs" role="tablist" aria-label="Category kind"><Button type="button" variant={kind === "expense" ? "primary" : "quiet"} role="tab" aria-selected={kind === "expense"} onClick={() => { setKind("expense"); }}>Expense</Button><Button type="button" variant={kind === "income" ? "primary" : "quiet"} role="tab" aria-selected={kind === "income"} onClick={() => { setKind("income"); }}>Income</Button></div>
    {status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
    {showForm ? <CategoryForm category={editing} onSuccess={() => { setShowForm(false); setEditing(undefined); void refresh(); }} /> : null}
    {list.length === 0 ? <div className="empty-state"><h2>No {kind} categories</h2><p>Create a category or seed starter categories during onboarding.</p><Button type="button" onClick={() => { setShowForm(true); }}>Create category</Button></div> : <div className="card-list">{list.map((category) => {
      const archived = Boolean(category.archived_at);
      return <article className={`management-card ${archived ? "is-archived" : ""}`} key={category.id}><div><h2>{category.name}</h2><p className="muted">{archived ? "Archived" : "Active"}</p></div><div className="card-actions"><Button type="button" variant="quiet" onClick={() => { setEditing(category); setShowForm(true); }}>Rename</Button>{archived ? <Button type="button" onClick={() => void restoreCategory(category.id)} disabled={restore.isPending}>Restore</Button> : confirming === category.id ? <div className="confirm-box" role="alert"><p>Archive this category? Active recurring rules will pause.</p><Button type="button" variant="danger" onClick={() => void archiveCategory(category.id)} disabled={archive.isPending}>Confirm archive</Button><Button type="button" variant="quiet" onClick={() => { setConfirming(undefined); }}>Cancel</Button></div> : <Button type="button" variant="quiet" onClick={() => { setConfirming(category.id); }}>Archive</Button>}{deleting === category.id ? <div className="confirm-box" role="alert"><p>Delete category forever? This only works when no history references it.</p><Button type="button" variant="danger" onClick={() => void deleteCategory(category.id)} disabled={remove.isPending}>Delete forever</Button><Button type="button" variant="quiet" onClick={() => { setDeleting(undefined); }}>Cancel</Button></div> : <Button type="button" variant="quiet" onClick={() => { setDeleting(category.id); }}>Delete</Button>}</div></article>;
    })}</div>}
  </section>;
}
