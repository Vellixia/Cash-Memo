"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../features/auth/use-session";
import {
  SESSION_ACCESS_DELETION_ONLY,
  SESSION_ACCESS_FULL,
  clearSessionState,
  isSafeReturnPath,
} from "../lib/auth/session";
import type { SessionContract } from "../generated/api/model/sessionContract";

export type GateAccess = "full" | "deletion-only";

export type GateDecision =
  | { kind: "loading" }
  | { kind: "render" }
  | { kind: "redirect"; destination: string; clearPrivateCache: boolean };

/**
 * Frozen contract: the current-session route answers `403` for an authenticated session that is
 * not `FULL`, and `401` when there is no session at all. `DELETION_ONLY` is the only non-full
 * access level, so `403` is the authoritative restricted-mode signal available to the client.
 */
const RESTRICTED_SESSION_STATUS = 403;

/** Returns the access level a gate may trust, from the session body or the restricted status. */
export function resolveGateAccess({
  status,
  access,
  errorStatus,
}: {
  status: "pending" | "error" | "ready";
  access?: string;
  errorStatus?: number;
}): string | undefined {
  if (status === "ready") return access;
  if (status === "error" && errorStatus === RESTRICTED_SESSION_STATUS) {
    return SESSION_ACCESS_DELETION_ONLY;
  }
  return undefined;
}

/**
 * Decides what a session gate may mount before any child query runs. Every unknown or errored
 * state fails closed to `/login`, and a restricted session never reaches full-access children.
 */
export function resolveGateDecision({
  status,
  access,
  errorStatus,
  allow,
}: {
  status: "pending" | "error" | "ready";
  access?: string;
  errorStatus?: number;
  allow: GateAccess;
}): GateDecision {
  if (status === "pending") return { kind: "loading" };
  const effectiveAccess = resolveGateAccess({ status, access, errorStatus });
  if (effectiveAccess === SESSION_ACCESS_DELETION_ONLY) {
    return allow === "deletion-only"
      ? { kind: "render" }
      : { kind: "redirect", destination: "/deletion", clearPrivateCache: true };
  }
  if (effectiveAccess === SESSION_ACCESS_FULL) {
    return allow === "full"
      ? { kind: "render" }
      : { kind: "redirect", destination: "/app", clearPrivateCache: false };
  }
  return { kind: "redirect", destination: "/login", clearPrivateCache: true };
}

export function AuthGate({
  children,
  allow = "full",
}: {
  children: ReactNode;
  allow?: GateAccess;
}) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const sessionContract: SessionContract | undefined = (
    session.data as { data?: SessionContract } | undefined
  )?.data;
  const status = session.isPending
    ? "pending"
    : session.isError || !sessionContract
      ? "error"
      : "ready";
  const errorStatus = (session.error as { response?: { status?: number } } | null)?.response
    ?.status;
  const decision = resolveGateDecision({
    status,
    access: sessionContract?.access,
    errorStatus,
    allow,
  });
  const redirect = decision.kind === "redirect" ? decision : undefined;

  // A gate redirects at most once: clearing the cache refetches the session it just read.
  const redirected = useRef(false);

  useEffect(() => {
    if (!redirect || redirected.current) return;
    redirected.current = true;
    if (redirect.clearPrivateCache) clearSessionState(client);
    // Only a genuinely safe, non-destructive path is worth returning to after sign-in.
    router.replace(
      redirect.destination === "/login" && isSafeReturnPath(pathname)
        ? `/login?returnTo=${encodeURIComponent(pathname)}`
        : redirect.destination,
    );
  }, [client, pathname, redirect, router]);

  if (decision.kind !== "render") {
    return (
      <main className="loading-state" aria-live="polite">
        {decision.kind === "loading" ? "Checking session…" : "Redirecting…"}
      </main>
    );
  }

  return <>{children}</>;
}
