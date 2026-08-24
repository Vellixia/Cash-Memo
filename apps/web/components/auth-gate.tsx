"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "../features/auth/use-session";
import { clearSessionState, getSafeReturnPath } from "../lib/auth/session";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionContract } from "../generated/api/model/sessionContract";

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const sessionData: SessionContract | undefined = session.data as SessionContract | undefined;

  useEffect(() => {
    if (!session.isPending && (session.isError || !sessionData)) {
      clearSessionState(client);
      router.replace(`/login?returnTo=${encodeURIComponent(getSafeReturnPath(pathname))}`);
    }
  }, [client, pathname, router, session.isError, session.isPending, sessionData]);

  if (session.isPending || session.isError || !sessionData) {
    return <main className="loading-state" aria-live="polite">Checking session…</main>;
  }

  return <>{children}</>;
}
