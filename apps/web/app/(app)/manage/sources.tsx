"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { ChevronDown, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmojiField } from "@/components/emoji-field";
import { CurrencyPicker } from "@/components/currency-picker";
import { AmountField } from "@/components/amount-field";
import { OfflineHint } from "@/components/offline-hint";
import { card } from "@/components/summary";
import {
  useCreateSource,
  useDeletePlan,
  useMe,
  usePlans,
  useSources,
  useUpdateSource,
  useArchiveSource,
} from "@/lib/queries";
import { useOnline } from "@/lib/use-online";
import type { Source, SourceInput, SourceKind } from "@/lib/api";
import { balanceLabel, fitAmount, formatMoney, fromMinor, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

const KIND_ORDER: SourceKind[] = ["cash", "bank", "ewallet", "credit", "paylater", "other"];
const KIND_LABEL: Record<SourceKind, string> = {
  cash: "Cash",
  bank: "Bank",
  ewallet: "E-wallet",
  credit: "Credit card",
  paylater: "Pay later",
  other: "Other",
};
const isDebtKind = (kind: SourceKind) => kind === "credit" || kind === "paylater";

export function SourcesPanel() {
  const { data: sources, isLoading } = useSources();
  const active = (sources ?? []).filter((s) => !s.archived_at);
  const archived = (sources ?? []).filter((s) => s.archived_at);
  const groups = KIND_ORDER.map((kind) => ({ kind, items: active.filter((s) => s.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <div className="w-full max-w-2xl space-y-6">
      <OfflineHint className="rounded-2xl bg-muted px-4 py-3" />

      <AddSourceCard />

      {isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.kind} aria-label={`${KIND_LABEL[g.kind]} sources`} className="space-y-2">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{KIND_LABEL[g.kind]}</h2>
              <ul className={cn(card, "divide-y divide-border/70 overflow-hidden rounded-2xl")}>
                {g.items.map((s) => (
                  <SourceRow key={s.id} source={s} />
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 && (
            <p className={cn(card, "rounded-2xl px-5 py-8 text-center text-sm text-muted-foreground")}>No sources yet. Add one above.</p>
          )}
        </div>
      )}

      {archived.length > 0 && <ArchivedSection sources={archived} />}
    </div>
  );
}

const sourceSchema = z
  .object({
    name: z.string().min(1, "Give it a name").max(80, "Keep it under 80 characters"),
    kind: z.enum(["cash", "bank", "ewallet", "credit", "paylater", "other"]),
    emoji: z.string().nullable(),
    track_balance: z.boolean(),
    currency: z.string(),
    // Canonical "1234.5" (see lib/money.ts editAmount); may be empty when balance tracking is off.
    amount: z.string().regex(/^\d*(\.\d*)?$/, "Enter a number"),
    // Credit/paylater only, all optional: limit (canonical amount string) and day-of-month (1-31).
    creditLimit: z.string().regex(/^\d*(\.\d*)?$/, "Enter a number"),
    statementDay: z.string().regex(/^\d*$/, "Enter a day"),
    dueDay: z.string().regex(/^\d*$/, "Enter a day"),
  })
  .superRefine((v, ctx) => {
    if (v.track_balance && !/^[A-Z]{3}$/.test(v.currency)) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Pick a currency" });
    }
    for (const field of ["statementDay", "dueDay"] as const) {
      const n = Number(v[field]);
      if (v[field] && (n < 1 || n > 31)) ctx.addIssue({ code: "custom", path: [field], message: "1-31" });
    }
  });
type SourceValues = z.infer<typeof sourceSchema>;

function AddSourceCard() {
  const create = useCreateSource();
  const online = useOnline();
  const { data: me } = useMe();
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    reset,
    formState: { errors },
  } = useForm<SourceValues>({
    resolver: zodResolver(sourceSchema),
    defaultValues: {
      name: "",
      kind: "bank",
      emoji: null,
      track_balance: false,
      currency: me?.default_currency ?? "USD",
      amount: "",
      creditLimit: "",
      statementDay: "",
      dueDay: "",
    },
  });
  const [kind, trackBalance, currency, emoji] = useWatch({ control, name: ["kind", "track_balance", "currency", "emoji"] });
  const debt = isDebtKind(kind);

  // Once the account's default currency loads, seed the (still-empty) currency field with it.
  useEffect(() => {
    if (me?.default_currency && !currency) setValue("currency", me.default_currency);
  }, [me?.default_currency, currency, setValue]);

  async function onSubmit(values: SourceValues) {
    const openingRaw = values.track_balance ? toMinor(values.amount || "0", values.currency) : 0;
    // Credit limit, statement and due day only mean anything on a debt source that tracks a balance.
    const creditFields = debt && values.track_balance;
    try {
      await create.mutateAsync({
        name: values.name.trim(),
        kind: values.kind,
        emoji: values.emoji,
        track_balance: values.track_balance,
        currency: values.track_balance ? values.currency : null,
        // A debt's "Currently owed" reads positive but means a negative balance.
        opening_minor: debt ? -openingRaw : openingRaw,
        credit_limit_minor: creditFields && values.creditLimit ? toMinor(values.creditLimit, values.currency) : null,
        statement_day: creditFields && values.statementDay ? Number(values.statementDay) : null,
        due_day: creditFields && values.dueDay ? Number(values.dueDay) : null,
      });
      toast.success(`Added “${values.name.trim()}”`);
      reset({
        name: "",
        kind: values.kind,
        emoji: null,
        track_balance: false,
        currency: values.currency,
        amount: "",
        creditLimit: "",
        statementDay: "",
        dueDay: "",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add source");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn(card, "space-y-4 rounded-2xl p-4")} noValidate>
      <div className="flex items-center gap-2">
        <EmojiField
          value={emoji}
          onChange={(e) => setValue("emoji", e)}
          label="Choose emoji for new source"
          className="size-11 shrink-0 rounded-2xl"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <Input
            aria-label="Source name"
            aria-invalid={!!errors.name}
            placeholder="e.g. BCA, Visa, GoPay"
            className="h-11 rounded-2xl bg-card px-4"
            {...register("name")}
          />
          {errors.name && (
            <p role="alert" className="text-sm text-destructive">
              {errors.name.message}
            </p>
          )}
        </div>
        <Select value={kind} onValueChange={(v) => setValue("kind", v as SourceKind)} items={Object.fromEntries(KIND_ORDER.map((k) => [k, KIND_LABEL[k]]))}>
          <SelectTrigger aria-label="Kind" className="h-11 shrink-0 rounded-2xl bg-card px-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl p-1">
            {KIND_ORDER.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5">
        <span className="text-sm font-medium">Track balance</span>
        <Switch checked={trackBalance} onCheckedChange={(v) => setValue("track_balance", v)} aria-label="Track balance" />
      </label>

      {trackBalance && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Currency</span>
            <CurrencyPicker
              value={currency}
              defaultCurrency={me?.default_currency}
              onChange={(c) => {
                setValue("currency", c);
                setValue("amount", fitAmount(getValues("amount"), c));
              }}
              triggerLabel={`Currency ${currency || "—"}, change`}
              triggerClassName="flex h-11 w-full items-center rounded-xl border border-input bg-card px-3.5 text-left text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {currency || "Pick a currency"}
            </CurrencyPicker>
            {errors.currency && <p className="text-sm text-destructive">{errors.currency.message}</p>}
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{debt ? "Currently owed" : "Starting balance"}</span>
            <AmountField
              control={control}
              name="amount"
              currency={currency || "USD"}
              invalid={!!errors.amount}
              big={false}
              className="h-11 rounded-xl border border-input bg-card px-3.5 text-left text-base"
            />
            {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
          </div>
        </div>
      )}

      {trackBalance && debt && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Credit limit</span>
            <AmountField
              control={control}
              name="creditLimit"
              currency={currency || "USD"}
              invalid={!!errors.creditLimit}
              big={false}
              className="h-11 rounded-xl border border-input bg-card px-3.5 text-left text-base"
            />
            {errors.creditLimit && <p className="text-sm text-destructive">{errors.creditLimit.message}</p>}
          </div>
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Statement day</span>
            <Input type="number" min={1} max={31} placeholder="1-31" className="h-11 rounded-xl bg-card" {...register("statementDay")} />
            {errors.statementDay && <p className="text-sm text-destructive">{errors.statementDay.message}</p>}
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Due day</span>
            <Input type="number" min={1} max={31} placeholder="1-31" className="h-11 rounded-xl bg-card" {...register("dueDay")} />
            {errors.dueDay && <p className="text-sm text-destructive">{errors.dueDay.message}</p>}
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <OfflineHint className="text-xs" />
        <Button type="submit" className="ml-auto h-10 rounded-full px-4" disabled={create.isPending || !online}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add source
        </Button>
      </div>
    </form>
  );
}

function SourceRow({ source }: { source: Source }) {
  const update = useUpdateSource();
  const archive = useArchiveSource();
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function saveEmoji(emoji: string | null) {
    try {
      await update.mutateAsync({ id: source.id, patch: { emoji } });
      toast.success("Source updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update source");
    }
  }

  async function onArchive() {
    try {
      await archive.mutateAsync(source.id);
      setConfirm(false);
      toast.success("Source archived", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await update.mutateAsync({ id: source.id, patch: { archived: false } });
              toast.success(`Restored “${source.name}”`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not restore source");
            }
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not archive source");
    }
  }

  return (
    <>
    <li className="flex items-center gap-3 px-3 py-2.5" data-testid="source-row">
      <EmojiField
        value={source.emoji}
        onChange={saveEmoji}
        label={`Change emoji for ${source.name}`}
        disabled={!online}
        className="size-10 shrink-0 rounded-2xl border-transparent bg-muted"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{source.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {KIND_LABEL[source.kind]}
          {source.track_balance && source.currency && ` · ${balanceLabel(source.kind, source.balance_minor ?? 0, source.currency)}`}
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-xl text-muted-foreground md:size-9"
        aria-label={`Edit ${source.name}`}
        onClick={() => setEditing(true)}
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
              aria-label={`Archive ${source.name}`}
              disabled={!online}
            />
          }
        >
          <Trash2 />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{source.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Past memos keep pointing to it and its balance stays put — you just can’t pick it for new ones. You can restore it any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onArchive} disabled={archive.isPending || !online}>
              {archive.isPending && <Loader2 className="animate-spin" />}
              Archive source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {editing && <EditSourceDialog source={source} onClose={() => setEditing(false)} />}
    </li>
    {source.track_balance && isDebtKind(source.kind) && <CreditPanel source={source} />}
    </>
  );
}

/** Name, emoji and balance tracking (currency + opening balance) of an existing source. */
function EditSourceDialog({ source, onClose }: { source: Source; onClose: () => void }) {
  const update = useUpdateSource();
  const online = useOnline();
  const { data: me } = useMe();
  const debt = isDebtKind(source.kind);
  // A debt's opening reads positive ("owed at start") but is stored negative. Anything else starts empty.
  const shown = debt ? -source.opening_minor : source.opening_minor;
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<SourceValues>({
    resolver: zodResolver(sourceSchema),
    defaultValues: {
      name: source.name,
      kind: source.kind,
      emoji: source.emoji,
      track_balance: source.track_balance,
      currency: source.currency ?? me?.default_currency ?? "USD",
      amount: source.track_balance && source.currency && shown > 0 ? fromMinor(shown, source.currency) : "",
      creditLimit: "",
      statementDay: "",
      dueDay: "",
    },
  });
  const [trackBalance, currency, emoji] = useWatch({ control, name: ["track_balance", "currency", "emoji"] });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(values: SourceValues) {
    const patch: Partial<SourceInput> = {};
    const name = values.name.trim();
    if (name !== source.name) patch.name = name;
    if (values.emoji !== source.emoji) patch.emoji = values.emoji;
    if (values.track_balance !== source.track_balance) patch.track_balance = values.track_balance;
    // Turning tracking off also drops the currency, so no invisible lock is left on the source's memos.
    const nextCurrency = values.track_balance ? values.currency : null;
    if (nextCurrency !== source.currency) patch.currency = nextCurrency;
    // The opening balance only goes out when it could have changed, so an untouched field never rewrites it.
    if (values.track_balance && (dirtyFields.amount || patch.track_balance !== undefined || patch.currency !== undefined)) {
      const raw = toMinor(values.amount || "0", values.currency);
      patch.opening_minor = debt ? -raw : raw;
    }
    if (Object.keys(patch).length === 0) return onClose();
    try {
      await update.mutateAsync({ id: source.id, patch });
      toast.success("Source updated");
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update source";
      setError(
        /another currency/.test(message)
          ? `Some memos on “${source.name}” use a different currency than ${values.currency}. Pick the currency they use, or keep balance tracking off.`
          : message,
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="rounded-2xl sm:max-w-md">
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="font-serif text-xl leading-tight">Edit {source.name}</DialogTitle>
            <DialogDescription>{KIND_LABEL[source.kind]}</DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2">
            <EmojiField value={emoji} onChange={(e) => setValue("emoji", e, { shouldDirty: true })} label={`Emoji for ${source.name}`} className="size-11 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1 space-y-1">
              <Input autoFocus aria-label="Name" aria-invalid={!!errors.name} className="h-11 rounded-xl bg-card px-3.5" {...register("name")} />
              {errors.name && (
                <p role="alert" className="text-sm text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5">
            <span className="text-sm font-medium">Track balance</span>
            <Switch
              checked={trackBalance}
              onCheckedChange={(v) => {
                setValue("track_balance", v);
                setError(null);
              }}
              aria-label="Track balance"
            />
          </label>

          {trackBalance ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Currency</span>
                <CurrencyPicker
                  value={currency}
                  defaultCurrency={me?.default_currency}
                  onChange={(c) => {
                    setValue("currency", c);
                    setValue("amount", fitAmount(getValues("amount"), c));
                    setError(null);
                  }}
                  triggerLabel={`Currency ${currency || "—"}, change`}
                  triggerClassName="flex h-11 w-full items-center rounded-xl border border-input bg-card px-3.5 text-left text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {currency || "Pick a currency"}
                </CurrencyPicker>
                {errors.currency && <p className="text-sm text-destructive">{errors.currency.message}</p>}
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{debt ? "Owed at start" : "Starting balance"}</span>
                <AmountField
                  control={control}
                  name="amount"
                  currency={currency || "USD"}
                  invalid={!!errors.amount}
                  big={false}
                  className="h-11 rounded-xl border border-input bg-card px-3.5 text-left text-base"
                />
                {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                The balance is this starting amount plus every memo on {source.name}. Memos then stay in {currency || "this currency"}.
              </p>
            </div>
          ) : (
            source.track_balance && (
              <p className="text-xs text-muted-foreground">
                Its balance stops showing and memos on it can use any currency again. Your memos stay as they are.
              </p>
            )
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-10 rounded-xl" disabled={update.isPending || !online}>
              {update.isPending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Credit limit, statement/due day and this source's active installment plans, editable inline. */
function CreditPanel({ source }: { source: Source }) {
  const update = useUpdateSource();
  const { data: plans } = usePlans();
  const cancelPlan = useDeletePlan();
  const online = useOnline();
  const [limit, setLimit] = useState(source.credit_limit_minor != null ? fromMinor(source.credit_limit_minor, source.currency!) : "");
  const [statementDay, setStatementDay] = useState(source.statement_day?.toString() ?? "");
  const [dueDay, setDueDay] = useState(source.due_day?.toString() ?? "");
  const mine = (plans ?? []).filter((p) => p.source_id === source.id);

  async function save() {
    try {
      await update.mutateAsync({
        id: source.id,
        patch: {
          credit_limit_minor: limit ? toMinor(limit, source.currency!) : null,
          statement_day: statementDay ? Number(statementDay) : null,
          due_day: dueDay ? Number(dueDay) : null,
        },
      });
      toast.success("Credit details updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update credit details");
    }
  }

  async function cancel(id: string) {
    try {
      await cancelPlan.mutateAsync(id);
      toast.success("Plan cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel plan");
    }
  }

  return (
    <li className="space-y-2.5 border-t border-border/70 bg-muted/30 px-3 py-3" data-testid="credit-panel">
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">Limit</span>
          <Input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="0"
            inputMode="decimal"
            aria-label={`Credit limit for ${source.name}`}
            className="h-9 rounded-lg bg-card text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">Statement day</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={statementDay}
            onChange={(e) => setStatementDay(e.target.value)}
            aria-label={`Statement day for ${source.name}`}
            className="h-9 rounded-lg bg-card text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">Due day</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            aria-label={`Due day for ${source.name}`}
            className="h-9 rounded-lg bg-card text-sm"
          />
        </label>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" onClick={save} disabled={update.isPending || !online}>
        {update.isPending && <Loader2 className="animate-spin" />}
        Save credit details
      </Button>
      {mine.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {mine.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-xs" data-testid="plan-row">
              <span className="min-w-0 truncate">
                {(p.note ?? "Installments").replace(/\s*\(\d+\/\d+\)$/, "")} · {p.paid}/{p.months} ·{" "}
                {formatMoney(Math.floor((p.principal_minor + p.fee_minor) / p.months), p.currency)}/mo
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 rounded-lg px-2 text-muted-foreground hover:text-destructive"
                onClick={() => cancel(p.id)}
                disabled={cancelPlan.isPending || !online}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ArchivedSection({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const update = useUpdateSource();
  const online = useOnline();

  async function restore(s: Source) {
    try {
      await update.mutateAsync({ id: s.id, patch: { archived: false } });
      toast.success(`Restored “${s.name}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore source");
    }
  }

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="archived-sources"
        className="flex min-h-11 items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden />
        Archived ({sources.length})
      </button>
      {open && (
        <ul id="archived-sources" className={cn(card, "divide-y divide-border/70 overflow-hidden rounded-2xl opacity-75")}>
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="source-row">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-lg" aria-hidden>
                {s.emoji || "🙂"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {KIND_LABEL[s.kind]}
                  {s.track_balance && s.currency && ` · ${balanceLabel(s.kind, s.balance_minor ?? 0, s.currency)}`}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 rounded-xl"
                onClick={() => restore(s)}
                disabled={update.isPending || !online}
              >
                <RotateCcw /> Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
