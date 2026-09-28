"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { shiftMonth } from "@/lib/format";
import { useUiStore } from "@/lib/store";

/** Desktop keyboard shortcuts: n = new memo, ←/→ = previous/next month (Home only), / = search.
 * Ignored while typing, while a modifier is held, or while a dialog/sheet is open. Mount once in AppShell. */
export function Shortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const openEditor = useUiStore((s) => s.openEditor);
  const month = useUiStore((s) => s.month);
  const setMonth = useUiStore((s) => s.setMonth);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      // Base UI unmounts dialog/sheet popups when closed, so their presence means one is open.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      if (e.key === "n") {
        e.preventDefault();
        openEditor();
      } else if (e.key === "/") {
        e.preventDefault();
        if (pathname === "/search") document.getElementById("search-input")?.focus();
        else router.push("/search");
      } else if (pathname === "/" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        setMonth(shiftMonth(month, e.key === "ArrowLeft" ? -1 : 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, pathname, openEditor, month, setMonth]);

  return null;
}
