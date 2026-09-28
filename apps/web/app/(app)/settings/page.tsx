"use client";

import Link from "next/link";
import { ChevronRight, Download, FileUp, Loader2, Repeat, Share, Tags } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeSelect } from "@/components/theme-select";
import { AppearanceSettings } from "@/components/appearance-settings";
import { card } from "@/components/summary";
import { CurrencyPicker } from "@/components/currency-picker";
import { useInstall } from "@/lib/install";
import { currencyName } from "@/lib/money";
import type { ExportResult } from "@/lib/api";
import { useJob, useMe, useStartExport, useUpdateMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** App-wide preferences and configuration. Account/security lives on /account instead (#14). */
export default function SettingsPage() {
  const { data: me } = useMe();
  const updateMe = useUpdateMe();
  const { canInstall, iosHint, install } = useInstall();

  async function setDefaultCurrency(code: string) {
    if (code === me?.default_currency) return;
    try {
      await updateMe.mutateAsync({ default_currency: code });
      toast.success(`New memos will start in ${code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the default currency");
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Settings</h1>

      <Link
        href="/account"
        className={cn(card, "flex items-center gap-4 p-5 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40")}
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-income-soft font-serif text-xl text-income ring-1 ring-border">
          {me?.email?.[0]?.toUpperCase() ?? "·"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">Account</p>
          {me ? (
            <p className="truncate font-medium" data-testid="settings-account-email">
              {me.email}
            </p>
          ) : (
            <Skeleton className="mt-1 h-4 w-44" />
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>

      <section className={cn(card, "space-y-3 p-5")} aria-labelledby="appearance">
        <h2 id="appearance" className="text-sm font-medium">
          Appearance
        </h2>
        <ThemeSelect />
        <AppearanceSettings />
      </section>

      <section className={cn(card, "flex items-center gap-4 p-5")} aria-labelledby="default-currency">
        <div className="min-w-0 flex-1">
          <h2 id="default-currency" className="text-sm font-medium">
            Default currency
          </h2>
          <p className="text-sm text-muted-foreground">New memos start in it.</p>
        </div>
        {me ? (
          <CurrencyPicker
            value={me.default_currency}
            defaultCurrency={me.default_currency}
            onChange={setDefaultCurrency}
            triggerLabel={`Default currency ${me.default_currency}, change`}
            triggerClassName="flex min-h-11 max-w-[55%] shrink-0 items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 md:min-h-10"
          >
            {updateMe.isPending ? <Loader2 className="size-4 animate-spin" /> : <span className="font-semibold tracking-wider">{me.default_currency}</span>}
            <span className="truncate text-muted-foreground" data-testid="default-currency-name">
              {currencyName(me.default_currency)}
            </span>
          </CurrencyPicker>
        ) : (
          <Skeleton className="h-10 w-36 rounded-xl" />
        )}
      </section>

      <Link
        href="/categories"
        className={cn(card, "flex items-center gap-3 p-5 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40")}
      >
        <Tags className="size-5 text-muted-foreground" />
        <span className="flex-1 font-medium">Manage categories</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

      <Link
        href="/recurring"
        className={cn(card, "flex items-center gap-3 p-5 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40")}
      >
        <Repeat className="size-5 text-muted-foreground" />
        <span className="flex-1 font-medium">Recurring memos</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

      <DataSection />

      {(canInstall || iosHint) && (
        <section className={cn(card, "flex items-center gap-4 p-5")} aria-labelledby="install-app">
          <div className="min-w-0 flex-1">
            <h2 id="install-app" className="text-sm font-medium">
              App
            </h2>
            {canInstall ? (
              <p className="text-sm text-muted-foreground">Open Cash Memo from your home screen or dock, even offline.</p>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="ios-install-hint">
                On iPhone: Share <Share className="inline size-3.5 align-[-0.1em]" aria-label="(the share icon)" /> → Add to Home Screen
              </p>
            )}
          </div>
          {canInstall && (
            <Button variant="outline" className="h-11 shrink-0 rounded-xl md:h-10" onClick={install}>
              <Download /> Install app
            </Button>
          )}
        </section>
      )}
      <p className="text-center text-xs text-muted-foreground">Cash Memo {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}</p>
    </div>
  );
}

function DataSection() {
  const start = useStartExport();
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | null>(null);
  const { data: job } = useJob<ExportResult>(jobId);

  async function onExport() {
    setStartError(null);
    try {
      const { job_id } = await start.mutateAsync();
      setJobId(job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start export";
      setStartError(message === "file storage isn't configured" ? "Export isn't available on this server." : message);
    }
  }

  const busy = start.isPending || (job && job.status !== "done" && job.status !== "failed");

  return (
    <section className={cn(card, "space-y-3 p-5")} aria-labelledby="your-data">
      <h2 id="your-data" className="text-sm font-medium">
        Your data
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-11 rounded-xl" onClick={onExport} disabled={!!busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          Export my data
        </Button>
        {job?.status === "done" && job.result && (
          <a
            href={job.download_url ?? undefined}
            download
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-income-soft px-4 text-sm font-medium text-income hover:brightness-95"
          >
            <Download className="size-4" /> Download ({job.result.rows} rows)
          </a>
        )}
        <Link href="/settings/import" className="inline-flex h-11 items-center gap-2 rounded-xl border border-input bg-card px-4 text-sm font-medium hover:bg-muted">
          <FileUp className="size-4" /> Import from CSV
        </Link>
      </div>
      {(startError || (job?.status === "failed" && job.error)) && (
        <p role="alert" className="rounded-xl bg-expense-soft px-3.5 py-2.5 text-sm text-expense">
          {startError ?? job?.error}
        </p>
      )}
    </section>
  );
}
