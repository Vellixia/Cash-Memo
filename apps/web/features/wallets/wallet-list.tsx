"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListWalletsQueryKey,
  useArchiveWallet,
  useDeleteWallet,
  useListWallets,
  useRestoreWallet,
} from "../../generated/api";
import type { WalletContract } from "../../generated/api/model/walletContract";
import { Button } from "../../components/ui/button";
import { WalletForm } from "./wallet-form";

function errorText(error: unknown): string {
  const value = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function WalletList() {
  const queryClient = useQueryClient();
  const wallets = useListWallets({ query: { retry: 1 } });
  const archive = useArchiveWallet();
  const restore = useRestoreWallet();
  const remove = useDeleteWallet();
  const [editing, setEditing] = useState<WalletContract>();
  const [showForm, setShowForm] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const list = wallets.data?.data ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: getListWalletsQueryKey() });
  }

  async function archiveWallet(id: string) {
    setStatus(undefined);
    try {
      const response = await archive.mutateAsync({ walletId: id });
      const count = response.data.paused_recurring_count;
      setStatus({ kind: "success", text: count > 0 ? `Wallet archived. ${String(count)} recurring ${count === 1 ? "rule" : "rules"} paused.` : "Wallet archived." });
      setConfirming(undefined);
      await refresh();
    } catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }

  async function restoreWallet(id: string) {
    setStatus(undefined);
    try { await restore.mutateAsync({ walletId: id }); setStatus({ kind: "success", text: "Wallet restored. Recurring rules stay paused until you resume them." }); await refresh(); }
    catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }

  async function deleteWallet(id: string) {
    setStatus(undefined);
    try { await remove.mutateAsync({ walletId: id }); setDeleting(undefined); setStatus({ kind: "success", text: "Wallet deleted." }); await refresh(); }
    catch (error) { setDeleting(undefined); setStatus({ kind: "error", text: `Wallet cannot be deleted while it has history. ${errorText(error)}` }); }
  }

  if (wallets.isPending) return <p className="loading-state" aria-live="polite">Loading wallets…</p>;
  if (wallets.isError) return <section><h1>Wallets</h1><p role="alert" className="field-error">Could not load wallets.</p><Button type="button" onClick={() => void wallets.refetch()}>Retry</Button></section>;

  return (
    <section className="management-page">
      <div className="page-heading"><div><p className="muted">Money containers</p><h1>Wallets</h1></div><Button type="button" onClick={() => { setEditing(undefined); setShowForm(true); }}>Create wallet</Button></div>
      <p className="muted">Each wallet has one immutable currency. Archive keeps history and removes it from new entries.</p>
      {status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
      {showForm ? <WalletForm wallet={editing} onSuccess={() => { setShowForm(false); setEditing(undefined); void refresh(); }} /> : null}
      {list.length === 0 ? <div className="empty-state"><h2>No wallets yet</h2><p>Create your first wallet to start tracking money.</p><Button type="button" onClick={() => { setShowForm(true); }}>Create wallet</Button></div> : <div className="card-list">{list.map((wallet) => {
        const archived = Boolean(wallet.archived_at);
        return <article className={`management-card ${archived ? "is-archived" : ""}`} key={wallet.id}>
          <div><h2>{wallet.name}</h2><p className="muted">{wallet.currency} · Balance {wallet.balance.amount}</p><p className="muted">{archived ? "Archived" : "Active"}</p></div>
          <div className="card-actions">
            <Button type="button" variant="quiet" onClick={() => { setEditing(wallet); setShowForm(true); }}>Edit name</Button>
            {archived ? <Button type="button" onClick={() => void restoreWallet(wallet.id)} disabled={restore.isPending}>Restore</Button> : confirming === wallet.id ? <div className="confirm-box" role="alert"><p>Archive this wallet? Active recurring rules will pause.</p><Button type="button" variant="danger" onClick={() => void archiveWallet(wallet.id)} disabled={archive.isPending}>Confirm archive</Button><Button type="button" variant="quiet" onClick={() => { setConfirming(undefined); }}>Cancel</Button></div> : <Button type="button" variant="quiet" onClick={() => { setConfirming(wallet.id); }}>Archive</Button>}
            {deleting === wallet.id ? <div className="confirm-box" role="alert"><p>Delete wallet forever? This cannot be undone.</p><Button type="button" variant="danger" onClick={() => void deleteWallet(wallet.id)} disabled={remove.isPending}>Delete forever</Button><Button type="button" variant="quiet" onClick={() => { setDeleting(undefined); }}>Cancel</Button></div> : <Button type="button" variant="quiet" onClick={() => { setDeleting(wallet.id); }}>Delete</Button>}
          </div>
        </article>;
      })}</div>}
    </section>
  );
}
