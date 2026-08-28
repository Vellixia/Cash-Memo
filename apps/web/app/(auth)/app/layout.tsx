import type { ReactNode } from "react";
import { AuthGate } from "../../../components/auth-gate";
import { FullAccessAppShell } from "../../../components/full-access-app-shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthGate><FullAccessAppShell>{children}</FullAccessAppShell></AuthGate>;
}
