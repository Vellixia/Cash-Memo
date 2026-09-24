"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronLeft, ChevronRight, LogOut, Monitor, Moon, Sun, Tags } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useLogout, useMe } from "@/lib/queries";
import { useUiStore } from "@/lib/store";
import { toast } from "sonner";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function AppHeader() {
  const router = useRouter();
  const month = useUiStore((s) => s.month);
  const setMonth = useUiStore((s) => s.setMonth);
  const { data: me } = useMe();
  const logout = useLogout();
  const { theme, setTheme } = useTheme();

  async function onLogout() {
    try {
      await logout.mutateAsync();
    } catch {
      // session cookie is likely already gone; proceed to /login regardless
    } finally {
      router.push("/login");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo size={26} />
          <span className="hidden sm:inline">Cash Memo</span>
        </Link>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="ghost" size="sm" className="min-w-24 tabular-nums">
                  {monthLabel(month)}
                </Button>
              }
            />
            <PopoverContent className="w-auto p-3">
              <label htmlFor="month-picker" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Jump to month
              </label>
              <Input id="month-picker" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="Account menu">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{me?.email?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                </Avatar>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{me?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/categories" />}>
              <Tags /> Categories
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-muted-foreground">Theme</DropdownMenuLabel>
            <div className="flex gap-1 px-1.5 pb-1.5">
              {(
                [
                  { value: "light", icon: Sun, label: "Light" },
                  { value: "dark", icon: Moon, label: "Dark" },
                  { value: "system", icon: Monitor, label: "System" },
                ] as const
              ).map(({ value, icon: Icon, label }) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={theme === value ? "secondary" : "ghost"}
                  className="flex-1"
                  aria-label={label}
                  onClick={() => setTheme(value)}
                >
                  <Icon />
                </Button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                onLogout();
                toast("Logged out");
              }}
            >
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
