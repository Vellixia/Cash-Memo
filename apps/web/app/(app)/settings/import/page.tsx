"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, FileUp, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencyPicker } from "@/components/currency-picker";
import { OfflineHint } from "@/components/offline-hint";
import { card } from "@/components/summary";
import { useOnline } from "@/lib/use-online";
import { parseCsv, previewCsv, type Delimiter } from "@/lib/csv";
import { uploadImportFile, utcOffsetMinutes, type CommitResult, type DateOrder, type Job, type Mapping, type ValidateResult } from "@/lib/api";
import { useInvalidateAfterImport, useJob, useMe, useStartCommit, useStartImportUpload, useStartValidate } from "@/lib/queries";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50 * 1024 * 1024;
const PREVIEW_BYTES = 64 * 1024;
const PREVIEW_ROWS = 20;

type FieldKey = "date" | "amount" | "direction" | "currency" | "category" | "source" | "to_source" | "note";
const FIELDS: { key: FieldKey; label: string; required: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "direction", label: "Direction", required: false },
  { key: "currency", label: "Currency", required: false },
  { key: "category", label: "Category", required: false },
  { key: "source", label: "Source", required: false },
  { key: "to_source", label: "To source", required: false },
  { key: "note", label: "Note", required: false },
];

/** Header names (ours, and common bank/Indonesian export names) auto-mapped case-insensitively. */
const SYNONYMS: Record<FieldKey, string[]> = {
  date: ["date", "tanggal", "tanggal transaksi", "transaction date", "posting date", "waktu"],
  amount: ["amount", "jumlah", "nominal", "value", "amount (idr)", "debit/credit amount"],
  direction: ["direction", "type", "tipe", "jenis", "tipe transaksi", "debit/kredit"],
  currency: ["currency", "mata uang", "ccy", "curr"],
  category: ["category", "kategori"],
  source: ["source", "account", "akun", "wallet", "dompet", "rekening", "from"],
  to_source: ["to_source", "to source", "destination", "tujuan", "to", "rekening tujuan"],
  note: ["note", "notes", "keterangan", "description", "memo", "remark", "catatan"],
};

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ",", label: "Comma ( , )" },
  { value: ";", label: "Semicolon ( ; )" },
  { value: "\t", label: "Tab" },
];
const DECIMALS: { value: "." | ","; label: string }[] = [
  { value: ".", label: "Period — 1234.56" },
  { value: ",", label: "Comma — 1234,56" },
];
const DATE_ORDERS: { value: DateOrder; label: string }[] = [
  { value: "dmy", label: "Day/Month/Year" },
  { value: "mdy", label: "Month/Day/Year" },
];

type Cols = Record<FieldKey, string>; // column index as string, or "none"

function autoMap(headers: string[]): Cols {
  const cols = Object.fromEntries(FIELDS.map((f) => [f.key, "none"])) as Cols;
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const { key } of FIELDS) {
    const i = normalized.findIndex((h) => SYNONYMS[key].includes(h));
    if (i >= 0) cols[key] = String(i);
  }
  return cols;
}

function padRows(rows: string[][], maxRows: number): string[][] {
  const capped = rows.slice(0, maxRows);
  const width = capped.reduce((w, r) => Math.max(w, r.length), 0);
  return capped.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

export default function ImportPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");

  // Step 2
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [cols, setCols] = useState<Cols>(() => Object.fromEntries(FIELDS.map((f) => [f.key, "none"])) as Cols);
  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [decimal, setDecimal] = useState<"." | ",">(".");
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");

  // Upload/validate/commit
  const [importId, setImportId] = useState<string | undefined>(undefined);
  const [validateJobId, setValidateJobId] = useState<string | undefined>(undefined);
  const [commitJobId, setCommitJobId] = useState<string | undefined>(undefined);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: me } = useMe();
  const online = useOnline();
  const startUpload = useStartImportUpload();
  const startValidate = useStartValidate();
  const startCommit = useStartCommit();
  const invalidate = useInvalidateAfterImport();
  const validateJob = useJob<ValidateResult>(validateJobId);
  const commitJob = useJob<CommitResult>(commitJobId);

  const rows = useMemo(() => padRows(parseCsv(rawText, delimiter), PREVIEW_ROWS), [rawText, delimiter]);
  const headers = hasHeader ? (rows[0] ?? []) : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const columnCount = rows[0]?.length ?? 0;
  const columnLabel = (i: number) => (hasHeader && headers[i]?.trim() ? headers[i] : `Column ${i + 1}`);

  async function onPickFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".csv")) return toast.error("Pick a .csv file");
    if (f.size > MAX_BYTES) return toast.error("That file is larger than 50 MB");
    const chunk = await f.slice(0, PREVIEW_BYTES).text();
    const { delimiter: detected } = previewCsv(chunk, PREVIEW_ROWS);
    setFile(f);
    setRawText(chunk);
    setDelimiter(detected);
    setDefaultCurrency(me?.default_currency ?? "USD");
    setCols(autoMap(parseCsv(chunk, detected)[0] ?? []));
    setImportId(undefined);
    setValidateJobId(undefined);
    setStep(2);
  }

  function mapping(): Mapping {
    const idx = (key: FieldKey) => (cols[key] === "none" ? null : Number(cols[key]));
    return {
      has_header: hasHeader,
      date: idx("date") ?? 0,
      amount: idx("amount") ?? 0,
      direction: idx("direction"),
      currency: idx("currency"),
      category: idx("category"),
      source: idx("source"),
      to_source: idx("to_source"),
      note: idx("note"),
      default_currency: defaultCurrency,
      decimal,
      delimiter,
      date_order: dateOrder,
      offset: utcOffsetMinutes(),
    };
  }

  async function onContinueToValidate() {
    if (cols.date === "none" || cols.amount === "none") return toast.error("Map both Date and Amount");
    setPhaseError(null);
    setStep(3);
    try {
      let id = importId;
      if (!id || !file) {
        if (!file) throw new Error("Pick a file first");
        setUploading(true);
        const up = await startUpload.mutateAsync();
        await uploadImportFile(up.upload_url, file);
        id = up.import_id;
        setImportId(id);
      }
      setUploading(false);
      const { job_id } = await startValidate.mutateAsync({ importId: id, mapping: mapping() });
      setValidateJobId(job_id);
    } catch (err) {
      setUploading(false);
      setPhaseError(err instanceof Error ? err.message : "Could not start the import");
    }
  }

  async function onCommit() {
    if (!validateJobId) return;
    setPhaseError(null);
    try {
      const { job_id } = await startCommit.mutateAsync(validateJobId);
      setCommitJobId(job_id);
      setStep(4);
    } catch (err) {
      setPhaseError(err instanceof Error ? err.message : "Could not import");
    }
  }

  // The commit job flips to "done" while this component is still mounted (step 4, polling); invalidate
  // once, right then, rather than every render.
  const committedRows = commitJob.data?.status === "done" ? commitJob.data.result : undefined;
  useEffect(() => {
    if (committedRows) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!committedRows]);

  if (committedRows) {
    const { inserted, duplicates } = committedRows;
    return (
      <div className="mx-auto w-full max-w-xl space-y-6 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-income-soft text-income">
          <CheckCircle2 className="size-7" />
        </span>
        <h1 className="font-serif text-3xl tracking-tight">Imported</h1>
        <p className="text-muted-foreground">
          Imported {inserted} {inserted === 1 ? "memo" : "memos"}
          {duplicates > 0 && ` (${duplicates} duplicate${duplicates === 1 ? "" : "s"} skipped)`}.
        </p>
        <Link href="/" className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Go home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Settings
        </Link>
        <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Import from CSV</h1>
      </header>
      <OfflineHint className="rounded-2xl bg-muted px-4 py-3" />

      {step === 1 && <StepFile onPick={onPickFile} />}

      {step === 2 && (
        <StepMapping
          columnCount={columnCount}
          columnLabel={columnLabel}
          dataRows={dataRows}
          hasHeader={hasHeader}
          setHasHeader={(v) => {
            setHasHeader(v);
            setCols(autoMap(v ? (parseCsv(rawText, delimiter)[0] ?? []) : []));
          }}
          delimiter={delimiter}
          setDelimiter={(d) => setDelimiter(d)}
          cols={cols}
          setCols={setCols}
          defaultCurrency={defaultCurrency}
          setDefaultCurrency={setDefaultCurrency}
          decimal={decimal}
          setDecimal={setDecimal}
          dateOrder={dateOrder}
          setDateOrder={setDateOrder}
          fileName={file?.name}
          onBack={() => setStep(1)}
          onContinue={onContinueToValidate}
          online={online}
        />
      )}

      {step === 3 && (
        <StepValidate
          uploading={uploading}
          validateJob={validateJob.data}
          error={phaseError}
          onChangeMapping={() => setStep(2)}
          onCommit={onCommit}
          committing={startCommit.isPending}
          online={online}
        />
      )}

      {step === 4 && <StepCommit commitJob={commitJob.data} error={phaseError} />}
    </div>
  );
}

function StepFile({ onPick }: { onPick: (f: File) => void }) {
  return (
    <section className={cn(card, "space-y-4 rounded-2xl p-6 text-center")}>
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <UploadCloud className="size-7" />
      </span>
      <div>
        <p className="font-medium">Pick a CSV file to import</p>
        <p className="text-sm text-muted-foreground">Up to 50 MB. Exported from your bank, wallet, or Cash Memo itself.</p>
      </div>
      <label className="mx-auto inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <FileUp className="size-4" /> Choose file
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
      </label>
    </section>
  );
}

function FieldSelect({
  field,
  value,
  onChange,
  columnCount,
  columnLabel,
}: {
  field: { key: FieldKey; label: string; required: boolean };
  value: string;
  onChange: (v: string) => void;
  columnCount: number;
  columnLabel: (i: number) => string;
}) {
  const items: Record<string, string> = Object.fromEntries([
    ...(field.required ? [] : [["none", "— not in this file —"]]),
    ...Array.from({ length: columnCount }, (_, i) => [String(i), columnLabel(i)]),
  ]);
  const mapped = value !== "none";
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {field.label}
        {field.required && " *"}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v ?? "none")} items={items}>
        <SelectTrigger
          aria-label={field.label}
          className={cn("h-11 w-full rounded-xl bg-card px-3", mapped && "ring-1 ring-income/40")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-xl p-1">
          {!field.required && <SelectItem value="none">— not in this file —</SelectItem>}
          {Array.from({ length: columnCount }, (_, i) => (
            <SelectItem key={i} value={String(i)}>
              {columnLabel(i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StepMapping({
  columnCount,
  columnLabel,
  dataRows,
  hasHeader,
  setHasHeader,
  delimiter,
  setDelimiter,
  cols,
  setCols,
  defaultCurrency,
  setDefaultCurrency,
  decimal,
  setDecimal,
  dateOrder,
  setDateOrder,
  fileName,
  onBack,
  onContinue,
  online,
}: {
  columnCount: number;
  columnLabel: (i: number) => string;
  dataRows: string[][];
  hasHeader: boolean;
  setHasHeader: (v: boolean) => void;
  delimiter: Delimiter;
  setDelimiter: (d: Delimiter) => void;
  cols: Cols;
  setCols: (c: Cols) => void;
  defaultCurrency: string;
  setDefaultCurrency: (c: string) => void;
  decimal: "." | ",";
  setDecimal: (d: "." | ",") => void;
  dateOrder: DateOrder;
  setDateOrder: (d: DateOrder) => void;
  fileName: string | undefined;
  onBack: () => void;
  onContinue: () => void;
  online: boolean;
}) {
  const mappedIndexes = new Set(Object.values(cols).filter((v) => v !== "none").map(Number));

  return (
    <div className="space-y-5">
      <section className={cn(card, "space-y-4 rounded-2xl p-5")}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{fileName ?? "Your file"}</h2>
          <label className="flex items-center gap-2 text-sm">
            First row is a header
            <Switch checked={hasHeader} onCheckedChange={setHasHeader} aria-label="First row is a header" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Separator</span>
            <Select value={delimiter} onValueChange={(v) => setDelimiter(v as Delimiter)} items={Object.fromEntries(DELIMITERS.map((d) => [d.value, d.label]))}>
              <SelectTrigger aria-label="Separator" className="h-11 w-full rounded-xl bg-card px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl p-1">
                {DELIMITERS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Decimal</span>
            <Select value={decimal} onValueChange={(v) => setDecimal(v as "." | ",")} items={Object.fromEntries(DECIMALS.map((d) => [d.value, d.label]))}>
              <SelectTrigger aria-label="Decimal separator" className="h-11 w-full rounded-xl bg-card px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl p-1">
                {DECIMALS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Date order</span>
            <Select value={dateOrder} onValueChange={(v) => setDateOrder(v as DateOrder)} items={Object.fromEntries(DATE_ORDERS.map((d) => [d.value, d.label]))}>
              <SelectTrigger aria-label="Date order" className="h-11 w-full rounded-xl bg-card px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl p-1">
                {DATE_ORDERS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Default currency</span>
          <p className="text-xs text-muted-foreground">Used when there’s no currency column, or a cell is empty.</p>
          <CurrencyPicker
            value={defaultCurrency}
            defaultCurrency={defaultCurrency}
            onChange={setDefaultCurrency}
            triggerLabel={`Default currency ${defaultCurrency}, change`}
            triggerClassName="flex h-11 w-full items-center gap-2 rounded-xl border border-input bg-card px-3.5 text-left text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <span className="font-semibold tracking-wider">{defaultCurrency}</span>
          </CurrencyPicker>
        </div>
      </section>

      <section className={cn(card, "space-y-3 rounded-2xl p-5")}>
        <h2 className="text-sm font-medium">Columns</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <FieldSelect key={f.key} field={f} value={cols[f.key]} onChange={(v) => setCols({ ...cols, [f.key]: v })} columnCount={columnCount} columnLabel={columnLabel} />
          ))}
        </div>
      </section>

      <section className={cn(card, "space-y-2 overflow-hidden rounded-2xl p-5")}>
        <h2 className="text-sm font-medium">Preview</h2>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-max border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                {Array.from({ length: columnCount }, (_, i) => (
                  <th
                    key={i}
                    className={cn(
                      "whitespace-nowrap border-b border-border px-3 py-2 font-medium text-muted-foreground",
                      mappedIndexes.has(i) && "bg-income-soft text-income",
                    )}
                  >
                    {columnLabel(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((cell, ci) => (
                    <td key={ci} className={cn("whitespace-nowrap border-b border-border/60 px-3 py-1.5", mappedIndexes.has(ci) && "bg-income-soft/40")}>
                      {cell || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {dataRows.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={Math.max(columnCount, 1)}>
                    No data rows to preview.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" className="h-11 rounded-xl" onClick={onBack}>
          <ArrowLeft /> Choose a different file
        </Button>
        <Button className="h-11 rounded-xl px-6" onClick={onContinue} disabled={!online}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function StepValidate({
  uploading,
  validateJob,
  error,
  onChangeMapping,
  onCommit,
  committing,
  online,
}: {
  uploading: boolean;
  validateJob: Job<ValidateResult> | undefined;
  error: string | null;
  onChangeMapping: () => void;
  onCommit: () => void;
  committing: boolean;
  online: boolean;
}) {
  if (error) {
    return (
      <section className={cn(card, "space-y-4 rounded-2xl p-6 text-center")}>
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-expense-soft text-expense">
          <AlertCircle className="size-6" />
        </span>
        <p className="text-sm text-expense">{error}</p>
        <Button variant="outline" className="h-11 rounded-xl" onClick={onChangeMapping}>
          <ArrowLeft /> Change mapping
        </Button>
      </section>
    );
  }

  if (uploading || !validateJob || validateJob.status === "queued" || validateJob.status === "running") {
    return (
      <section className={cn(card, "space-y-3 rounded-2xl p-8 text-center")}>
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{uploading ? "Uploading your file…" : "Checking your file…"}</p>
      </section>
    );
  }

  if (validateJob.status === "failed") {
    return (
      <section className={cn(card, "space-y-4 rounded-2xl p-6 text-center")}>
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-expense-soft text-expense">
          <AlertCircle className="size-6" />
        </span>
        <p className="text-sm text-expense">{validateJob.error ?? "That file couldn’t be read."}</p>
        <Button variant="outline" className="h-11 rounded-xl" onClick={onChangeMapping}>
          <ArrowLeft /> Change mapping
        </Button>
      </section>
    );
  }

  const r = validateJob.result;
  if (!r) return null;
  const shownErrors = r.errors.slice(0, 20);

  return (
    <div className="space-y-5">
      <section className={cn(card, "space-y-3 rounded-2xl p-5")}>
        <h2 className="text-sm font-medium">Report</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Rows" value={r.rows} />
          <Stat label="Valid" value={r.valid} tone="income" />
          <Stat label="Errors" value={r.error_count} tone={r.error_count > 0 ? "expense" : undefined} />
          <Stat label="Duplicates" value={r.duplicates} />
        </div>
        {Object.keys(r.currencies).length > 0 && (
          <p className="text-sm text-muted-foreground">
            Currencies: {Object.entries(r.currencies).map(([c, n]) => `${c} (${n})`).join(", ")}
          </p>
        )}
        {r.new_categories.length > 0 && (
          <p className="text-sm text-muted-foreground">New categories: {r.new_categories.join(", ")}</p>
        )}
        {r.new_sources.length > 0 && <p className="text-sm text-muted-foreground">New sources: {r.new_sources.join(", ")}</p>}
      </section>

      {shownErrors.length > 0 && (
        <section className={cn(card, "space-y-2 rounded-2xl p-5")}>
          <h2 className="text-sm font-medium text-expense">Rows with problems</h2>
          <ul className="space-y-1 text-sm">
            {shownErrors.map((e, i) => (
              <li key={i} className="text-muted-foreground">
                <span className="font-medium text-foreground">Line {e.line}:</span> {e.message}
              </li>
            ))}
          </ul>
          {r.error_count > shownErrors.length && <p className="text-xs text-muted-foreground">and {r.error_count - shownErrors.length} more</p>}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" className="h-11 rounded-xl" onClick={onChangeMapping}>
          <ArrowLeft /> Change mapping
        </Button>
        <Button className="h-11 rounded-xl px-6" onClick={onCommit} disabled={r.valid === 0 || r.committed || committing || !online}>
          {committing && <Loader2 className="animate-spin" />}
          {r.committed ? "Already imported" : `Import ${r.valid} row${r.valid === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "income" | "expense" }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2.5">
      <p className={cn("text-lg font-semibold tabular-nums", tone === "income" && "text-income", tone === "expense" && "text-expense")}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StepCommit({ commitJob, error }: { commitJob: Job<CommitResult> | undefined; error: string | null }) {
  // A "done" job is handled by the page component itself (it swaps in the success screen); this only
  // ever needs to show the in-flight or failed states.
  if (error || commitJob?.status === "failed") {
    return (
      <section className={cn(card, "space-y-4 rounded-2xl p-6 text-center")}>
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-expense-soft text-expense">
          <AlertCircle className="size-6" />
        </span>
        <p className="text-sm text-expense">{error ?? commitJob?.error ?? "Could not import"}</p>
      </section>
    );
  }
  return (
    <section className={cn(card, "space-y-3 rounded-2xl p-8 text-center")}>
      <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Importing…</p>
    </section>
  );
}
