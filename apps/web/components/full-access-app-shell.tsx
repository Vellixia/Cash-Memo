"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const AppShell = dynamic(
  () => import("./app-shell/app-shell").then((module) => module.AppShell),
  {
    loading: () => (
      <main className="loading-state" aria-live="polite">
        Opening your journal…
      </main>
    ),
  },
);

export function FullAccessAppShell({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
