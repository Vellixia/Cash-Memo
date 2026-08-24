import type { ReactNode } from "react";
import { AppShell } from "../../../components/app-shell/app-shell";
import { AuthGate } from "../../../components/auth-gate";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthGate><AppShell>{children}</AppShell></AuthGate>;
}
