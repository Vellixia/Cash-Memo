import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { ReloadButton } from "./reload-button";

export const metadata: Metadata = { title: "Offline · Cash Memo" };

/** Precached by the service worker; shown for pages that were never opened while online. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo size={48} />
      <h1 className="font-serif text-3xl">You&apos;re offline</h1>
      <p className="max-w-xs text-sm text-muted-foreground">
        This page hasn&apos;t been saved for offline use yet. Reconnect and it will load, and next time it will
        open without a connection too.
      </p>
      <ReloadButton />
    </main>
  );
}
