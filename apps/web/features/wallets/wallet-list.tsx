"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTransactionEntryDefaultsQueryKey,
  getGetWalletQueryKey,
  getListRecurringTransactionsQueryKey,
  getListWalletsQueryKey,
  useArchiveWallet,
  useDeleteWallet,
  useListWallets,
  useRestoreWallet,
} from "../../generated/api";
import type { WalletContract } from "../../generated/api/model/walletContract";
import { MoneyAmount } from "../../components/money/amount";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { WalletForm } from "./wallet-form";

function errorText(error: unknown): string {
  const value = error as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
  return value.response?.data?.error?.message ?? value.message ?? "Request unavailable. Try again.";
}

export function WalletList() {
  const client = useQueryClient();
  const wallets = useListWallets({ query: { retry: 1 } });
  const archive = useArchiveWallet();
  const restore = useRestoreWallet();
  const remove = useDeleteWallet();
  const [editing, setEditing] = useState<WalletContract>();
  const [formOpen, setFormOpen] = useState(false);
  const [archiving, setArchiving] = useState<WalletContract>();
  const [deleting, setDeleting] = useState<WalletContract>();
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string }>();
  const list = wallets.data?.data ?? [];

  async function invalidateWallet(walletId?: string) {
    await Promise.all([
      client.invalidateQueries({ queryKey: getListWalletsQueryKey() }),
      ...(walletId ? [client.invalidateQueries({ queryKey: getGetWalletQueryKey(walletId) })] : []),
    ]);
  }
  async function archiveWallet(wallet: WalletContract) {
    setStatus(undefined);
    try {
      const response = await archive.mutateAsync({ walletId: wallet.id });
      await Promise.all([
        invalidateWallet(wallet.id),
        client.invalidateQueries({ queryKey: getGetTransactionEntryDefaultsQueryKey() }),
        client.invalidateQueries({ queryKey: getListRecurringTransactionsQueryKey() }),
      ]);
      const count = response.data.paused_recurring_count;
      setArchiving(undefined);
      setStatus({ kind: "success", text: count > 0 ? `Wallet archived. ${String(count)} recurring ${count === 1 ? "rule" : "rules"} paused.` : "Wallet archived." });
    } catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  async function restoreWallet(wallet: WalletContract) {
    setStatus(undefined);
    try {
      await restore.mutateAsync({ walletId: wallet.id });
      await Promise.all([
        invalidateWallet(wallet.id),
        client.invalidateQueries({ queryKey: getGetTransactionEntryDefaultsQueryKey() }),
      ]);
      setStatus({ kind: "success", text: "Wallet restored. Recurring rules stay paused until you resume them." });
    } catch (error) { setStatus({ kind: "error", text: errorText(error) }); }
  }
  async function deleteWallet(wallet: WalletContract) {
    setStatus(undefined);
    try {
      await remove.mutateAsync({ walletId: wallet.id });
      setDeleting(undefined);
      setDeleteErrors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== wallet.id)));
      await invalidateWallet();
      setStatus({ kind: "success", text: "Wallet deleted." });
    } catch (error) {
      setDeleting(undefined);
      const message = `Wallet cannot be deleted while it has history. ${errorText(error)}`;
      setDeleteErrors((current) => ({ ...current, [wallet.id]: message }));
    }
  }

  if (wallets.isPending) return <p className="loading-state" aria-live="polite">Loading wallets…</p>;
  if (wallets.isError) return <section><h1>Wallets</h1><p role="alert" className="field-error">Could not load wallets.</p><Button type="button" onClick={() => void wallets.refetch()}>Retry</Button></section>;

  return <section className="management-page">
    <div className="page-heading"><div><p className="muted">Money containers</p><h1>Wallets</h1></div><Button type="button" onClick={() => { setEditing(undefined); setFormOpen(true); }}>Create wallet</Button></div>
    <p className="muted">Each wallet has one immutable currency. Archive keeps history and removes it from new entries.</p>
    {status ? <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "field-error" : "success"}>{status.text}</p> : null}
    <Dialog open={formOpen} onOpenChange={setFormOpen}>
      <DialogContent className="management-dialog">
        <DialogHeader><DialogTitle>{editing ? "Edit wallet" : "Create wallet"}</DialogTitle><DialogDescription>Wallet currency stays fixed after creation. Opening balance changes current wallet state only.</DialogDescription></DialogHeader>
        <WalletForm wallet={editing} showHeading={false} onCancel={() => setFormOpen(false)} onSuccess={() => { setFormOpen(false); setEditing(undefined); void invalidateWallet(editing?.id); }} />
      </DialogContent>
    </Dialog>
    {list.length === 0 ? <div className="empty-state"><h2>No wallets yet</h2><p>Create your first wallet to start tracking money.</p><Button type="button" onClick={() => { setEditing(undefined); setFormOpen(true); }}>Create wallet</Button></div> : <div className="card-list">{list.map((wallet) => {
      const archived = Boolean(wallet.archived_at);
      return <article className={`management-card management-row ${archived ? "is-archived" : ""}`} key={wallet.id}>
        <div><h2>{wallet.name}</h2><p className="muted"><MoneyAmount value={wallet.balance.amount} currency={wallet.currency} /> · {wallet.currency}</p><p className="muted"><span className="status-label">{archived ? "Archived" : "Active"}</span> · Opening balance {wallet.opening_balance}</p>{deleteErrors[wallet.id] ? <p role="alert" className="field-error">{deleteErrors[wallet.id]}</p> : null}</div>
        <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="quiet" aria-label={`Actions for ${wallet.name}`}>Actions</Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { setEditing(wallet); setFormOpen(true); }}>Edit wallet</DropdownMenuItem>{archived ? <DropdownMenuItem onClick={() => void restoreWallet(wallet)} disabled={restore.isPending}>Restore</DropdownMenuItem> : <DropdownMenuItem onClick={() => setArchiving(wallet)}>Archive</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleting(wallet)}>Delete forever</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </article>;
    })}</div>}
    <Dialog open={Boolean(archiving)} onOpenChange={(open) => { if (!open) setArchiving(undefined); }}>
      <DialogContent><DialogHeader><DialogTitle>Archive {archiving?.name}?</DialogTitle><DialogDescription>Archiving keeps history, removes wallet from new entries, and pauses dependent recurring rules. Restore will not resume those rules.</DialogDescription></DialogHeader><div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setArchiving(undefined)}>Cancel</Button><Button type="button" variant="danger" onClick={() => archiving && void archiveWallet(archiving)} disabled={archive.isPending}>{archive.isPending ? "Archiving…" : "Archive wallet"}</Button></div></DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(undefined); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete wallet forever?</AlertDialogTitle><AlertDialogDescription>Delete {deleting?.name} permanently? This is allowed only when no history references this wallet. The server decides whether deletion can proceed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="danger" onClick={() => deleting && void deleteWallet(deleting)} disabled={remove.isPending} aria-busy={remove.isPending}>{remove.isPending ? "Deleting…" : "Delete forever"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
