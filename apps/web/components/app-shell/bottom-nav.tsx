"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import {
  addShellLink,
  mobileMoreShellLinks,
  mobileShellLinks,
  type ShellNavItem,
} from "./sidebar";

function MobileLink({
  item,
  pathname,
  onNavigate,
}: {
  item: ShellNavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="bottom-nav-link"
      aria-current={pathname === item.href ? "page" : undefined}
      onClick={onNavigate}
    >
      <Icon className="shell-link-icon" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        <ul>
          {mobileShellLinks.map((item) => (
            <li key={item.href}>
              <MobileLink item={item} pathname={pathname} />
            </li>
          ))}
          <li>
            <SheetTrigger className="bottom-nav-button">
              <MoreHorizontal className="shell-link-icon" aria-hidden="true" />
              <span>More</span>
            </SheetTrigger>
          </li>
        </ul>
      </nav>
      <SheetContent side="bottom" className="bottom-nav-sheet">
        <SheetHeader>
          <SheetTitle>More</SheetTitle>
          <SheetDescription>Same destinations as desktop navigation.</SheetDescription>
        </SheetHeader>
        <nav aria-label="More navigation">
          <ul className="bottom-nav-sheet-links">
            {mobileMoreShellLinks.map((item) => (
              <li key={item.href}>
                <MobileLink item={item} pathname={pathname} onNavigate={() => setOpen(false)} />
              </li>
            ))}
            <li>
              <MobileLink item={addShellLink} pathname={pathname} onNavigate={() => setOpen(false)} />
            </li>
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
