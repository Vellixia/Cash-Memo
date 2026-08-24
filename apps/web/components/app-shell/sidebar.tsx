"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Overview", "/app"],
  ["History", "/app/transactions"],
  ["Add", "/app/transactions/new"],
  ["Wallets", "/app/wallets"],
  ["Categories", "/app/categories"],
  ["Budgets", "/app/budgets"],
  ["Recurring", "/app/recurring"],
  ["Settings", "/app/settings"],
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/app" className="brand">
        Cashmemo
      </Link>
      <nav aria-label="Primary navigation">
        {links.map(([label, href]) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
