"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Home, LogOut, Plus, Tags, UserRound } from "lucide-react";
import { Logo } from "@/components/logo";
import { MemoEditor } from "@/components/memo-editor";
import { THEMES } from "@/components/theme-select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useLogout, useMe } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/categories", label: "Categories", icon: Tags },
] as const;

/** Log out, then hard-navigate so no cached query refetches (and 401s) on the way out. */
export function useLogoutAndLeave() {
  const logout = useLogout();
  return {
    pending: logout.isPending || logout.isSuccess,
    run: async () => {
      try {
        await logout.mutateAsync();
      } catch {
        // The session may already be gone; leaving for /login is still right.
      }
      window.location.replace("/login");
    },
  };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const openEditor = useUiStore((s) => s.openEditor);
  return (
    <>
      <TopBar onNew={() => openEditor()} />
      <main className="mx-auto w-full max-w-[44rem] flex-1 px-4 pt-4 pb-32 md:px-6 md:pt-8 md:pb-16">{children}</main>
      <BottomNav onNew={() => openEditor()} />
      <MemoEditor />
    </>
  );
}

function TopBar({ onNew }: { onNew: () => void }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[44rem] items-center gap-2 px-4 md:h-16 md:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/40" aria-label="Cash Memo home">
          <Logo size={28} />
          <span className="font-serif text-lg tracking-tight">Cash Memo</span>
        </Link>
        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                pathname === href ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button onClick={onNew} className="h-9 rounded-full px-4">
            <Plus /> New memo
          </Button>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function AccountMenu() {
  const { data: me } = useMe();
  const { theme, setTheme } = useTheme();
  const logout = useLogoutAndLeave();
  const initial = me?.email?.[0]?.toUpperCase() ?? "·";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Account menu"
            className="flex size-9 items-center justify-center rounded-full bg-income-soft font-serif text-base text-income ring-1 ring-border transition-shadow outline-none hover:ring-income/40 focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:ring-income/50"
          />
        }
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">
            <span className="block text-[0.7rem] font-medium tracking-wide uppercase">Signed in as</span>
            <span className="block truncate text-sm font-normal text-foreground">{me?.email ?? "…"}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <MenuPrimitive.LinkItem render={<Link href="/categories" />} closeOnClick className={menuItem}>
            <Tags /> Categories
          </MenuPrimitive.LinkItem>
          <MenuPrimitive.LinkItem render={<Link href="/account" />} closeOnClick className={menuItem}>
            <UserRound /> Account
          </MenuPrimitive.LinkItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(v as string)}>
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value} className="px-2 py-1.5">
                <Icon /> {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="px-2 py-1.5" onClick={logout.run} disabled={logout.pending}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const menuItem =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

function BottomNav({ onNew }: { onNew: () => void }) {
  const pathname = usePathname();
  const tab = (href: string, label: string, Icon: typeof Home) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-xl py-1 text-[0.7rem] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <Icon className={cn("size-[1.35rem]", active && "text-income")} strokeWidth={active ? 2.2 : 1.8} />
        {label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/90 pb-safe backdrop-blur-md md:hidden"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-4 items-center px-2">
        {tab("/", "Home", Home)}
        {tab("/categories", "Categories", Tags)}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onNew}
            aria-label="Add memo"
            className="-mt-7 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_20px_-6px_color-mix(in_oklab,var(--primary)_60%,transparent)] ring-4 ring-background transition-transform outline-none active:scale-95 focus-visible:ring-ring/60"
          >
            <Plus className="size-6" strokeWidth={2.4} />
          </button>
        </div>
        {tab("/account", "Account", UserRound)}
      </div>
    </nav>
  );
}
