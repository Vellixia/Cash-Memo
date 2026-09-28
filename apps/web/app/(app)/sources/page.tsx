"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { ChevronDown, Loader2, Pencil, Plus, RotateCcw, Trash2, X, Check } from "lucide-react";
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
import { EmojiField } from "@/components/emoji-field";
import { CurrencyPicker } from "@/components/currency-picker";
import { AmountField } from "@/components/amount-field";
import { OfflineHint } from "@/components/offline-hint";
import { card } from "@/components/summary";
import { useCreateSource, useMe, useSources, useUpdateSource, useArchiveSource } from "@/lib/queries";
import { useOnline } from "@/lib/use-online";
import type { Source, SourceKind } from "@/lib/api";
import { balanceLabel, fitAmount, toMinor } from "@/lib/money";
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

export default function SourcesPage() {
  const { data: sources, isLoading } = useSources();
  const active = (sources ?? []).filter((s) => !s.archived_at);
  const archived = (sources ?? []).filter((s) => s.archived_at);
  const groups = KIND_ORDER.map((kind) => ({ kind, items: active.filter((s) => s.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Sources</h1>
        <p className="text-sm text-muted-foreground">Where your money lives — wallets, accounts and cards.</p>
      </header>
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
  })
  .superRefine((v, ctx) => {
    if (v.track_balance && !/^[A-Z]{3}$/.test(v.currency)) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Pick a currency" });
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
    defaultValues: { name: "", kind: "bank", emoji: null, track_balance: false, currency: me?.default_currency ?? "USD", amount: "" },
  });
  const [kind, trackBalance, currency] = useWatch({ control, name: ["kind", "track_balance", "currency"] });
  const debt = isDebtKind(kind);

  // Once the account's default currency loads, seed the (still-empty) currency field with it.
  useEffect(() => {
    if (me?.default_currency && !currency) setValue("currency", me.default_currency);
  }, [me?.default_currency, currency, setValue]);

  async function onSubmit(values: SourceValues) {
    const openingRaw = values.track_balance ? toMinor(values.amount || "0", values.currency) : 0;
    try {
      await create.mutateAsync({
        name: values.name.trim(),
        kind: values.kind,
        emoji: values.emoji,
        track_balance: values.track_balance,
        currency: values.track_balance ? values.currency : null,
        // A debt's "Currently owed" reads positive but means a negative balance.
        opening_minor: debt ? -openingRaw : openingRaw,
      });
      toast.success(`Added “${values.name.trim()}”`);
      reset({ name: "", kind: values.kind, emoji: null, track_balance: false, currency: values.currency, amount: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add source");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={cn(card, "space-y-4 rounded-2xl p-4")} noValidate>
      <div className="flex items-center gap-2">
        <EmojiField
          value={getValues("emoji")}
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
  const [name, setName] = useState(source.name);
  const [emoji, setEmoji] = useState<string | null>(source.emoji);
  const [confirm, setConfirm] = useState(false);

  async function save(patch: { name?: string; emoji?: string | null }, done?: () => void) {
    try {
      await update.mutateAsync({ id: source.id, patch });
      toast.success("Source updated");
      done?.();
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
          <EmojiField value={emoji} onChange={setEmoji} label={`Emoji for ${source.name}`} className="size-10 rounded-2xl" />
          <Input autoFocus aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-xl bg-card" />
          <Button type="submit" size="icon" className="size-10 rounded-xl" aria-label="Save source" disabled={update.isPending || !online}>
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
    <li className="flex items-center gap-3 px-3 py-2.5" data-testid="source-row">
      <EmojiField
        value={source.emoji}
        onChange={(e) => save({ emoji: e })}
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
        aria-label={`Rename ${source.name}`}
        onClick={() => {
          setName(source.name);
          setEmoji(source.emoji);
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
