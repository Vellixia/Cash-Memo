"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["Overview", "/app"],
  ["History", "/app/history"],
  ["Capture", "/app/capture"],
  ["Wallets", "/app/wallets"],
  ["Categories", "/app/categories"],
  ["Settings", "/app/settings"],
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <Link href="/app" className="brand">Cashmemo</Link>
      <nav>
        {links.map(([label, href]) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
