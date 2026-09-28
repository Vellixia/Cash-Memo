"use client";

import { useState } from "react";
import { Check, Loader2, Pause, Pencil, Play, Repeat, Square, X } from "lucide-react";
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
import { Segmented } from "@/components/segmented";
import { OfflineHint } from "@/components/offline-hint";
import { card } from "@/components/summary";
import type { Cadence, RecurringRule } from "@/lib/api";
import { dayLabel, signedAmount } from "@/lib/format";
import { formatMoney, fromMinor, parseAmount, signedMoney, toMinor } from "@/lib/money";
import { useCategories, useDeleteRecurring, useRecurring, useUpdateRecurring } from "@/lib/queries";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

const CADENCE: Record<Cadence, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

export default function RecurringPage() {
  const { data: rules, isLoading } = useRecurring();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Recurring</h1>
        <p className="text-sm text-muted-foreground">Memos that add themselves. Set one up with “Repeat” when you add a memo.</p>
      </header>
      <OfflineHint className="rounded-2xl bg-muted px-4 py-3" />
      {isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : !rules?.length ? (
        <p className={cn(card, "rounded-2xl px-5 py-8 text-center text-sm text-muted-foreground")}>Nothing repeats yet.</p>
      ) : (
        <ul className={cn(card, "divide-y divide-border/70 overflow-hidden rounded-2xl")} aria-label="Recurring memos">
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleRow({ rule }: { rule: RecurringRule }) {
  const { data: categories = [] } = useCategories();
  const update = useUpdateRecurring();
  const remove = useDeleteRecurring();
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const c = categories.find((x) => x.id === rule.category_id);
  const title = rule.note || c?.name || (rule.direction === "transfer" ? "Transfer" : "Untitled");
  const paused = !!rule.paused_at;

  async function patch(p: Parameters<typeof update.mutateAsync>[0]["patch"], message: string) {
    try {
      await update.mutateAsync({ id: rule.id, patch: p });
      toast.success(message);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
      return false;
    }
  }

  async function onStop() {
    try {
      await remove.mutateAsync(rule.id);
      setConfirm(false);
      toast.success(`Stopped “${title}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not stop");
    }
  }

  if (editing) return <RuleForm rule={rule} onSave={patch} onDone={() => setEditing(false)} saving={update.isPending} />;

  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5", paused && "text-muted-foreground")} data-testid="rule-row">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-lg" aria-hidden>
        {c?.emoji ?? <Repeat className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {CADENCE[rule.cadence]} · {paused ? "Paused" : `Next ${dayLabel(rule.next_date)}`}
        </span>
      </span>
      <span className={cn("num shrink-0", !paused && (rule.direction === "income" ? "text-income" : rule.direction === "expense" && "text-expense"))}>
        {rule.direction === "transfer" ? formatMoney(rule.amount_minor, rule.currency) : signedMoney(signedAmount(rule), rule.currency)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-xl text-muted-foreground md:size-9"
        aria-label={`${paused ? "Resume" : "Pause"} ${title}`}
        disabled={update.isPending || !online}
        onClick={() => patch({ paused: !paused }, paused ? "Resumed" : "Paused")}
      >
        {paused ? <Play /> : <Pause />}
      </Button>
      <Button variant="ghost" size="icon" className="size-11 rounded-xl text-muted-foreground md:size-9" aria-label={`Edit ${title}`} onClick={() => setEditing(true)}>
        <Pencil />
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-11 rounded-xl text-muted-foreground hover:text-destructive md:size-9"
              aria-label={`Stop ${title}`}
              disabled={!online}
            />
          }
        >
          <Square />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>No more memos will be added. The ones already in your ledger stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onStop} disabled={remove.isPending || !online}>
              {remove.isPending && <Loader2 className="animate-spin" />}
              Stop repeating
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function RuleForm({
  rule,
  onSave,
  onDone,
  saving,
}: {
  rule: RecurringRule;
  onSave: (patch: { amount_minor?: number; cadence?: Cadence; next_date?: string; note?: string | null }, message: string) => Promise<boolean>;
  onDone: () => void;
  saving: boolean;
}) {
  const online = useOnline();
  const [amount, setAmount] = useState(fromMinor(rule.amount_minor, rule.currency));
  const [cadence, setCadence] = useState<Cadence>(rule.cadence);
  const [nextDate, setNextDate] = useState(rule.next_date);
  const [note, setNote] = useState(rule.note ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount_minor = toMinor(parseAmount(amount, rule.currency), rule.currency);
    if (!(amount_minor > 0)) return toast.error("Enter an amount above zero");
    if (!nextDate) return toast.error("Pick the next date");
    // Only a changed date is sent, so a month-end rule keeps aiming for its day (e.g. the 31st).
    const patch = { amount_minor, cadence, note: note.trim() || null, ...(nextDate !== rule.next_date && { next_date: nextDate }) };
    if (await onSave(patch, "Recurring memo updated")) onDone();
  }

  return (
    <li>
      <form className="space-y-3 px-3 py-3" onSubmit={onSubmit} onKeyDown={(e) => e.key === "Escape" && onDone()}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Amount ({rule.currency})</span>
            <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10 rounded-xl bg-card" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Next date</span>
            <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="h-10 rounded-xl bg-card" />
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Note</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" className="h-10 rounded-xl bg-card" />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            size="sm"
            label="Repeat"
            value={cadence}
            onChange={setCadence}
            options={(Object.keys(CADENCE) as Cadence[]).map((k) => ({ value: k, label: CADENCE[k] }))}
          />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="h-10 rounded-xl" onClick={onDone}>
              <X /> Cancel
            </Button>
            <Button type="submit" className="h-10 rounded-xl" disabled={saving || !online}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />} Save
            </Button>
          </div>
        </div>
      </form>
    </li>
  );
}
