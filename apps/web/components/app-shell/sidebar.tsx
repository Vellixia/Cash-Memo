"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  PiggyBank,
  PlusCircle,
  Repeat2,
  Settings2,
  Tags,
  WalletCards,
  ReceiptText,
} from "lucide-react";
import { CurrentSessionSignOut } from "../../features/settings/session-controls";

export interface ShellNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const desktopShellLinks: readonly ShellNavItem[] = [
  { label: "Overview", href: "/app", icon: LayoutDashboard },
  { label: "Transactions", href: "/app/transactions", icon: ReceiptText },
  { label: "Wallets", href: "/app/wallets", icon: WalletCards },
  { label: "Categories", href: "/app/categories", icon: Tags },
  { label: "Budgets", href: "/app/budgets", icon: PiggyBank },
  { label: "Recurring", href: "/app/recurring", icon: Repeat2 },
  { label: "Settings", href: "/app/settings", icon: Settings2 },
] as const;

export const addShellLink: ShellNavItem = {
  label: "Add",
  href: "/app/transactions/new",
  icon: PlusCircle,
};

export const mobileShellLinks: readonly ShellNavItem[] = [
  desktopShellLinks[0],
  desktopShellLinks[1],
  addShellLink,
  desktopShellLinks[4],
] as const;

export const mobileMoreShellLinks: readonly ShellNavItem[] = [
  desktopShellLinks[2],
  desktopShellLinks[3],
  desktopShellLinks[5],
  desktopShellLinks[6],
] as const;

function SidebarLink({
  item,
  pathname,
}: {
  item: ShellNavItem;
  pathname: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="sidebar-link"
      aria-current={pathname === item.href ? "page" : undefined}
    >
      <Icon className="shell-link-icon" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const AddIcon = addShellLink.icon;
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Link href="/app" className="brand">
          Cashmemo
        </Link>
        <Link
          href={addShellLink.href}
          className="sidebar-link-action"
          aria-current={pathname === addShellLink.href ? "page" : undefined}
        >
          <AddIcon className="shell-link-icon" aria-hidden="true" />
          <span>{addShellLink.label}</span>
        </Link>
      </div>
      <nav aria-label="Primary navigation">
        <ul className="sidebar-links">
          {desktopShellLinks.map((item) => (
            <li key={item.href}>
              <SidebarLink item={item} pathname={pathname} />
            </li>
          ))}
        </ul>
      </nav>
      <CurrentSessionSignOut className="sidebar-sign-out" label="Sign out" />
    </aside>
  );
}
