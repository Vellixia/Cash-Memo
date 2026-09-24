"use client";

import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";

/** Shown next to write actions while offline; the actions themselves are disabled by their owners. */
export function OfflineHint({ className }: { className?: string }) {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" data-testid="offline-hint" className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <WifiOff className="size-4 shrink-0" aria-hidden />
      You’re offline — changes can’t be saved
    </p>
  );
}
