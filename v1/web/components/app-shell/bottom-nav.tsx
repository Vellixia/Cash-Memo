"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [["Overview", "/app"], ["History", "/app/history"], ["Capture", "/app/capture"], ["Wallets", "/app/wallets"], ["Categories", "/app/categories"]] as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {links.map(([label, href]) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
