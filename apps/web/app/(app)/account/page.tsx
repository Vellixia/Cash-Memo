"use client";

import Link from "next/link";
import { ChevronRight, Loader2, LogOut, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeSelect } from "@/components/theme-select";
import { useLogoutAndLeave } from "@/components/app-shell";
import { card } from "@/components/summary";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function AccountPage() {
  const { data: me } = useMe();
  const logout = useLogoutAndLeave();

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
