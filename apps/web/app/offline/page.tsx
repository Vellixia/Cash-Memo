import type { Metadata } from "next";
import { Logo } from "@/components/logo";

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
      {/* No page-specific JS: the worker precaches this HTML but not its chunks, so a GET form (reloads the current URL) it is. */}
      <form>
        <button type="submit" className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50">
          Try again
        </button>
      </form>
    </main>
  );
}
