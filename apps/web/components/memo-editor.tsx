"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Camera, Check, ImagePlus, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { EmojiField } from "@/components/emoji-field";
import { OfflineHint } from "@/components/offline-hint";
import { CurrencyPicker } from "@/components/currency-picker";
import { AmountField } from "@/components/amount-field";
import type { Direction, Memo, MemoDirection, Source } from "@/lib/api";
import { uploadAttachmentFile } from "@/lib/api";
import { processAttachment } from "@/lib/attachment";
import { fitAmount, fromMinor, toMinor } from "@/lib/money";
import { toDatetimeLocal } from "@/lib/format";
import {
  useAttachmentUrl,
  useCategories,
  useConfirmAttachment,
  useCreateCategory,
  useCreateMemo,
  useDeleteAttachment,
  useDeleteMemo,
  useMe,
  useRestoreMemo,
  useSources,
  useStartAttachmentUpload,
  useUpdateMemo,
} from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

const schema = z
  .object({
    direction: z.enum(["expense", "income", "transfer"]),
    // Canonical "1234.5" (the field shows it natively grouped); see lib/money.ts editAmount.
    amount: z
      .string()
      .min(1, "Enter an amount")
      .regex(/^\d+(\.\d*)?$/, "Enter a number like 12.50"),
    currency: z.string().regex(/^[A-Z]{3}$/, "Pick a currency"),
    occurred_at: z.string().min(1, "Pick a date and time"),
    category_id: z.string().nullable(),
    source_id: z.string().nullable(),
    to_source_id: z.string().nullable(),
    note: z.string().max(2000, "Keep notes under 2000 characters"),
  })
  .superRefine((v, ctx) => {
    if (/^[A-Z]{3}$/.test(v.currency) && /\d/.test(v.amount) && toMinor(v.amount, v.currency) <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount must be greater than zero" });
    }
    // Simplification: an expense always needs a source picked, even a legacy memo that had none.
    if (v.direction === "expense" && !v.source_id) {
      ctx.addIssue({ code: "custom", path: ["source_id"], message: "Choose where this came from" });
    }
    if (v.direction === "transfer") {
      if (!v.source_id || !v.to_source_id) {
        ctx.addIssue({ code: "custom", path: ["to_source_id"], message: "Pick both accounts" });
      } else if (v.source_id === v.to_source_id) {
        ctx.addIssue({ code: "custom", path: ["to_source_id"], message: "Pick two different accounts" });
      }
    }
  });
type Values = z.infer<typeof schema>;

/** Height of the on-screen keyboard (0 when closed), so the sheet and its Save button sit above it.
 * ponytail: visualViewport heuristic; switch to the VirtualKeyboard API / interactive-widget meta if it misfires. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** Add/edit memo: a bottom sheet below `md`, a centered dialog from `md` up (same element, CSS only). */
export function MemoEditor() {
  const open = useUiStore((s) => s.editorOpen);
  const editing = useUiStore((s) => s.editing);
  const editorKey = useUiStore((s) => s.editorKey);
  const closeEditor = useUiStore((s) => s.closeEditor);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const keyboard = useKeyboardInset();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && closeEditor()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[#1c1b19]/25 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/50" />
        <DialogPrimitive.Popup
          initialFocus={amountRef}
          data-testid="memo-editor"
          style={{ "--kb": `${keyboard}px` } as React.CSSProperties}
          className={cn(
            "fixed inset-x-0 bottom-(--kb) z-50 flex max-h-[calc(92dvh-var(--kb))] flex-col overflow-hidden rounded-t-[1.75rem] bg-card text-card-foreground shadow-2xl ring-1 ring-border outline-none",
            "transition-[translate,opacity,scale] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-y-full data-starting-style:translate-y-full",
            "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[90dvh] md:w-[min(28rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.75rem] md:duration-200",
            "md:data-ending-style:-translate-y-1/2 md:data-ending-style:scale-95 md:data-ending-style:opacity-0 md:data-starting-style:-translate-y-1/2 md:data-starting-style:scale-95 md:data-starting-style:opacity-0",
          )}
        >
          <div data-testid="sheet-handle" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border md:hidden" aria-hidden />
          <MemoForm key={editorKey} memo={editing} amountRef={amountRef} onDone={closeEditor} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function MemoForm({
  memo,
  amountRef,
  onDone,
}: {
  memo: Memo | null;
  amountRef: React.RefObject<HTMLInputElement | null>;
  onDone: () => void;
}) {
  const recentCurrencies = useUiStore((s) => s.recentCurrencies);
  const noteCurrency = useUiStore((s) => s.noteCurrency);
  const lastSourceId = useUiStore((s) => s.lastSourceId);
  const setLastSourceId = useUiStore((s) => s.setLastSourceId);
  const { data: me } = useMe();
  const { data: categories = [] } = useCategories();
  const { data: sources = [] } = useSources();
  const activeSources = sources.filter((s) => !s.archived_at);
  const createMemo = useCreateMemo();
  const updateMemo = useUpdateMemo();
  const deleteMemo = useDeleteMemo();
  const restoreMemo = useRestoreMemo();
  const startUpload = useStartAttachmentUpload();
  const confirmUpload = useConfirmAttachment();
  const online = useOnline();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A new memo has no id yet: a picked photo waits here until save creates one, then uploads.
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: memo?.direction ?? "expense",
      amount: memo ? fromMinor(memo.amount_minor, memo.currency) : "",
      currency: memo?.currency ?? me?.default_currency ?? recentCurrencies[0] ?? "USD",
      occurred_at: toDatetimeLocal(memo ? new Date(memo.occurred_at) : new Date()),
      category_id: memo?.category_id ?? null,
      source_id: memo?.source_id ?? null,
      to_source_id: memo?.to_source_id ?? null,
      note: memo?.note ?? "",
    },
  });

  const [direction, currency, categoryId, sourceId, toSourceId] = useWatch({
    control,
    name: ["direction", "currency", "category_id", "source_id", "to_source_id"],
  });
  const choices = categories.filter((c) => c.direction === direction);
  const saving = createMemo.isPending || updateMemo.isPending;

  // A new memo defaults its source to the last one used, falling back to the first active source.
  const autoSourceApplied = useRef(false);
  useEffect(() => {
    if (memo || autoSourceApplied.current || activeSources.length === 0) return;
    autoSourceApplied.current = true;
    const fallback = activeSources.find((s) => s.id === lastSourceId) ?? activeSources[0];
    setValue("source_id", fallback.id);
  }, [memo, activeSources, lastSourceId, setValue]);

  // A source with a fixed currency locks the memo to it.
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const lockedCurrency = sourceById.get(sourceId ?? "")?.currency ?? sourceById.get(toSourceId ?? "")?.currency ?? null;
  useEffect(() => {
    if (lockedCurrency && currency !== lockedCurrency) {
      setValue("currency", lockedCurrency);
      setValue("amount", fitAmount(getValues("amount"), lockedCurrency));
    }
  }, [lockedCurrency, currency, setValue, getValues]);

  function setDirection(d: MemoDirection) {
    setValue("direction", d);
    const current = categories.find((c) => c.id === categoryId);
    if (d !== "transfer" && current && current.direction !== d) setValue("category_id", null);
  }

  async function onSubmit(values: Values) {
    if (!online) return;
    const cur = values.currency;
    const isTransfer = values.direction === "transfer";
    const body = {
      direction: values.direction,
      amount_minor: toMinor(values.amount, cur),
      currency: cur,
      occurred_at: new Date(values.occurred_at).toISOString(),
      category_id: isTransfer ? null : values.category_id,
      source_id: values.source_id,
      to_source_id: isTransfer ? values.to_source_id : null,
      note: values.note.trim() || null,
    };
    try {
      let saved: Memo;
      if (memo) {
        saved = await updateMemo.mutateAsync({ id: memo.id, input: body });
        toast.success("Memo updated");
      } else {
        saved = await createMemo.mutateAsync(body);
        toast.success(isTransfer ? "Transfer added" : values.direction === "income" ? "Income added" : "Expense added");
      }
      noteCurrency(cur);
      if (values.source_id) setLastSourceId(values.source_id);
      // The memo is saved either way; a failed attachment upload never blocks or undoes that.
      if (pendingFile) await uploadPending(saved.id, pendingFile);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save memo");
    }
  }

  async function uploadPending(memoId: string, file: File) {
    try {
      const { blob, contentType } = await processAttachment(file);
      const { upload_url, key } = await startUpload.mutateAsync({ memoId, contentType });
      await uploadAttachmentFile(upload_url, blob, contentType);
      await confirmUpload.mutateAsync({ memoId, key });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attach that image");
    }
  }

  async function onDelete() {
    if (!memo) return;
    const id = memo.id;
    try {
      await deleteMemo.mutateAsync(id);
      setConfirmDelete(false);
      onDone();
      toast.success("Memo deleted", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await restoreMemo.mutateAsync(id);
              toast.success("Memo restored");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not restore memo");
            }
          },
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete memo");
    }
  }

  const tone = direction === "income" ? "text-income" : direction === "transfer" ? "text-foreground" : "text-expense";
  const lockedSourceName = sourceById.get(sourceId ?? "")?.currency
    ? sourceById.get(sourceId ?? "")?.name
    : sourceById.get(toSourceId ?? "")?.name;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="flex items-center justify-between gap-3 px-5 pt-3 md:pt-5">
        <DialogPrimitive.Title className="font-serif text-xl">{memo ? "Edit memo" : "New memo"}</DialogPrimitive.Title>
        <DialogPrimitive.Close
          render={<Button type="button" variant="ghost" size="icon" className="-mr-2 size-11 rounded-full md:size-9" aria-label="Close" />}
        >
          <X />
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pt-4 pb-5">
        <Segmented
          label="Direction"
          className="flex w-full"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "expense", label: "Expense", tone: "expense" },
            { value: "income", label: "Income", tone: "income" },
            { value: "transfer", label: "Transfer" },
          ]}
        />

        {/* Big amount */}
        <div className="flex flex-col items-center gap-2 py-2">
          {lockedCurrency ? (
            <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <Lock className="size-3" aria-hidden /> {currency}
            </span>
          ) : (
            <CurrencyPicker
              value={currency}
              defaultCurrency={me?.default_currency}
              onChange={(c) => {
                setValue("currency", c);
                setValue("amount", fitAmount(getValues("amount"), c));
              }}
              triggerLabel={`Currency ${currency}, change`}
              triggerClassName="min-h-8 rounded-full bg-muted px-3 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {currency}
            </CurrencyPicker>
          )}
          <AmountField control={control} name="amount" currency={currency} invalid={!!errors.amount} inputRef={amountRef} className={tone} />
          <div className="min-h-5 text-center text-sm" aria-live="polite">
            {errors.amount && <p className="text-destructive">{errors.amount.message}</p>}
            {!errors.amount && errors.currency && <p className="text-destructive">{errors.currency.message}</p>}
            {!errors.amount && !errors.currency && lockedCurrency && (
              <p className="text-muted-foreground">Currency locked to {lockedCurrency} by {lockedSourceName}</p>
            )}
          </div>
        </div>

        {direction === "transfer" ? (
          <>
            <fieldset className="space-y-2.5">
              <legend className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">From</legend>
              <SourceChips label="From account" sources={activeSources} value={sourceId} onChange={(id) => setValue("source_id", id)} onNavigate={onDone} />
            </fieldset>
            <fieldset className="space-y-2.5">
              <legend className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">To</legend>
              <SourceChips label="To account" sources={activeSources} value={toSourceId} onChange={(id) => setValue("to_source_id", id)} onNavigate={onDone} />
              {errors.to_source_id && <p className="text-sm text-destructive">{errors.to_source_id.message}</p>}
            </fieldset>
          </>
        ) : (
          <>
            {/* Category chips */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Category</legend>
              <CategoryChips
                direction={direction}
                choices={choices}
                value={categoryId}
                onChange={(id) => setValue("category_id", id)}
              />
            </fieldset>

            {/* Source chips */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {direction === "income" ? "Received in" : "Paid with"}
              </legend>
              <SourceChips
                label={direction === "income" ? "Received in" : "Paid with"}
                sources={activeSources}
                value={sourceId}
                onChange={(id) => setValue("source_id", id)}
                onNavigate={onDone}
              />
              {errors.source_id && <p className="text-sm text-destructive">{errors.source_id.message}</p>}
            </fieldset>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Date &amp; time</span>
            <Input type="datetime-local" className="h-11 rounded-xl bg-card md:h-10" aria-invalid={!!errors.occurred_at} {...register("occurred_at")} />
            {errors.occurred_at && <span className="text-sm text-destructive">{errors.occurred_at.message}</span>}
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Note</span>
            <Input placeholder="What was it for?" className="h-11 rounded-xl bg-card md:h-10" autoComplete="off" {...register("note")} />
            {errors.note && <span className="text-sm text-destructive">{errors.note.message}</span>}
          </label>
        </div>

        <AttachmentField
          memoId={memo?.id ?? null}
          hasAttachment={memo?.has_attachment ?? false}
          pendingFile={pendingFile}
          onPendingFile={setPendingFile}
        />
      </div>

      {/* Outside the scroll area, so Save stays put above the keyboard / home indicator. */}
      <div className="space-y-2 border-t bg-card px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <OfflineHint className="justify-center text-xs" />
        <div className="flex gap-2">
        {memo && (
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="ghost" size="lg" className="h-11 rounded-xl px-4 text-destructive hover:bg-expense-soft hover:text-destructive" disabled={deleteMemo.isPending || !online}>
                  <Trash2 /> Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this memo?</AlertDialogTitle>
                <AlertDialogDescription>It will disappear from your ledger and totals. This can’t be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onDelete} disabled={deleteMemo.isPending || !online}>
                  {deleteMemo.isPending && <Loader2 className="animate-spin" />}
                  Delete memo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button type="submit" size="lg" className="h-11 flex-1 rounded-xl text-[0.95rem]" disabled={saving || !online}>
          {saving && <Loader2 className="animate-spin" />}
          {memo ? "Save changes" : direction === "income" ? "Save income" : direction === "transfer" ? "Save transfer" : "Save expense"}
        </Button>
        </div>
      </div>
    </form>
  );
}

/** Optional receipt/photo. Without a memo id yet (a new memo), a picked file just stages via
 * `onPendingFile`; MemoForm uploads it once Save creates the memo. With an id, it uploads (or
 * replaces/removes) right away, independent of the Save button. */
function AttachmentField({
  memoId,
  hasAttachment,
  pendingFile,
  onPendingFile,
}: {
  memoId: string | null;
  hasAttachment: boolean;
  pendingFile: File | null;
  onPendingFile: (file: File | null) => void;
}) {
  const online = useOnline();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const startUpload = useStartAttachmentUpload();
  const confirmUpload = useConfirmAttachment();
  const deleteAttachment = useDeleteAttachment();
  const [attached, setAttached] = useState(hasAttachment);
  const [busy, setBusy] = useState(false);
  const attachmentUrl = useAttachmentUrl(memoId ?? undefined, attached && !pendingFile);
  const previewUrl = useMemo(() => (pendingFile ? URL.createObjectURL(pendingFile) : null), [pendingFile]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function pick(file: File | null) {
    if (!file) return;
    if (!memoId) {
      onPendingFile(file);
      return;
    }
    setBusy(true);
    try {
      const { blob, contentType } = await processAttachment(file);
      const { upload_url, key } = await startUpload.mutateAsync({ memoId, contentType });
      await uploadAttachmentFile(upload_url, blob, contentType);
      await confirmUpload.mutateAsync({ memoId, key });
      setAttached(true);
      toast.success("Attachment saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attach that image");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (pendingFile) {
      onPendingFile(null);
      return;
    }
    if (!memoId) return;
    setBusy(true);
    try {
      await deleteAttachment.mutateAsync(memoId);
      setAttached(false);
      toast.success("Attachment removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove attachment");
    } finally {
      setBusy(false);
    }
  }

  const shown = !!pendingFile || attached;
  const thumbUrl = previewUrl ?? attachmentUrl.data?.url;

  return (
    <fieldset className="space-y-2.5">
      <legend className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Attachment</legend>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {shown ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => thumbUrl && window.open(thumbUrl, "_blank")}
            disabled={!thumbUrl}
            className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted ring-1 ring-border"
            aria-label="View attachment full size"
          >
            {thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a presigned/blob URL, not a static asset
              <img src={thumbUrl} alt="" className="size-full object-cover" />
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
            )}
          </button>
          <div className="flex flex-1 flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy || !online} onClick={() => fileRef.current?.click()}>
              Replace
            </Button>
            <Button type="button" variant="ghost" size="sm" className="rounded-full text-destructive" disabled={busy || !online} onClick={remove}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy || !online} onClick={() => cameraRef.current?.click()}>
            <Camera className="size-4" /> Take photo
          </Button>
          <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy || !online} onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-4" /> Choose image
          </Button>
        </div>
      )}
    </fieldset>
  );
}

function CategoryChips({
  direction,
  choices,
  value,
  onChange,
}: {
  direction: Direction;
  choices: { id: string; name: string; emoji: string | null }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const createCategory = useCreateCategory();
  const online = useOnline();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const c = await createCategory.mutateAsync({ name: trimmed, direction, emoji });
      onChange(c.id);
      setName("");
      setEmoji(null);
      setAdding(false);
      toast.success(`Added “${c.name}”`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add category");
    }
  }

  const chip =
    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 pointer-coarse:h-11 pointer-coarse:px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
        {choices.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? null : c.id)}
              className={cn(
                chip,
                active
                  ? direction === "income"
                    ? "border-income bg-income-soft text-income"
                    : "border-expense bg-expense-soft text-expense"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {c.emoji && <span aria-hidden>{c.emoji}</span>}
              {c.name}
              {active && <Check className="size-3.5" aria-hidden />}
            </button>
          );
        })}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={cn(chip, "border-dashed border-input text-muted-foreground hover:text-foreground")}>
            <Plus className="size-4" /> New
          </button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-2 rounded-2xl bg-muted/60 p-2">
          <EmojiField value={emoji} onChange={setEmoji} />
          <Input
            autoFocus
            aria-label="New category name"
            placeholder={`New ${direction} category`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
              }
            }}
            className="h-9 rounded-xl bg-card"
          />
          <Button type="button" onClick={add} disabled={!name.trim() || createCategory.isPending || !online} className="h-9 rounded-xl">
            {createCategory.isPending ? <Loader2 className="animate-spin" /> : "Add"}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl" aria-label="Cancel new category" onClick={() => setAdding(false)}>
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}

const sourceChip =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 pointer-coarse:h-11 pointer-coarse:px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

/** A horizontally-scrolling row of active-source chips, with a trailing link to add one. */
function SourceChips({
  label,
  sources,
  value,
  onChange,
  onNavigate,
}: {
  label: string;
  sources: Source[];
  value: string | null;
  onChange: (id: string | null) => void;
  onNavigate: () => void;
}) {
  return (
    <div
      className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label={label}
    >
      {sources.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : s.id)}
            className={cn(sourceChip, active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted")}
          >
            {s.emoji && <span aria-hidden>{s.emoji}</span>}
            {s.name}
            {active && <Check className="size-3.5" aria-hidden />}
          </button>
        );
      })}
      <Link href="/sources" onClick={onNavigate} aria-label="Add new source" className={cn(sourceChip, "border-dashed border-input text-muted-foreground hover:text-foreground")}>
        <Plus className="size-4" /> New
      </Link>
    </div>
  );
}
