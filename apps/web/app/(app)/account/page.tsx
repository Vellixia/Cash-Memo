"use client";

import Link from "next/link";
import { ChevronRight, Download, Loader2, LogOut, Share, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeSelect } from "@/components/theme-select";
import { useLogoutAndLeave } from "@/components/app-shell";
import { card } from "@/components/summary";
import { CurrencyPicker } from "@/components/currency-picker";
import { useInstall } from "@/lib/install";
import { currencyName } from "@/lib/money";
import { useMe, useUpdateMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function AccountPage() {
  const { data: me } = useMe();
  const logout = useLogoutAndLeave();
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
      <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Account</h1>

      <section className={cn(card, "flex items-center gap-4 p-5")} aria-label="Profile">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-income-soft font-serif text-xl text-income ring-1 ring-border">
          {me?.email?.[0]?.toUpperCase() ?? "·"}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Signed in as</p>
          {me ? (
            <p className="truncate font-medium" data-testid="account-email">
              {me.email}
            </p>
          ) : (
            <Skeleton className="mt-1 h-4 w-44" />
          )}
        </div>
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

      <section className={cn(card, "space-y-3 p-5")} aria-labelledby="appearance">
        <h2 id="appearance" className="text-sm font-medium">
          Appearance
        </h2>
        <ThemeSelect />
      </section>

      <Link
        href="/categories"
        className={cn(card, "flex items-center gap-3 p-5 transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/40")}
      >
        <Tags className="size-5 text-muted-foreground" />
        <span className="flex-1 font-medium">Manage categories</span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

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

      <Button
        variant="outline"
        className="h-11 w-full rounded-2xl border-expense/30 bg-card text-expense hover:bg-expense-soft hover:text-expense"
        onClick={logout.run}
        disabled={logout.pending}
      >
        {logout.pending ? <Loader2 className="animate-spin" /> : <LogOut />}
        Log out
      </Button>
    </div>
  );
}
