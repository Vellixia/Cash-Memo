import type { ReactNode } from "react";
import { BottomNav } from "./bottom-nav";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main" tabIndex={-1}>{children}</main>
      <BottomNav />
    </div>
  );
}
