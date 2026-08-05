"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { ApiProblemError, apiRequest } from "@/lib/api/client";
import type { components } from "@/lib/api/generated";

export type AccountPartition = Readonly<{ accountId: string }>;
export type AccountSessionState =
  | Readonly<{ status: "loading"; account: null }>
  | Readonly<{ status: "authenticated"; account: AccountPartition }>
  | Readonly<{ status: "unauthenticated" | "unavailable"; account: null }>;

type AuthenticatedSession = components["schemas"]["AuthenticatedSession"];

const loadingState: AccountSessionState = { status: "loading", account: null };
let sessionState: AccountSessionState = loadingState;
const listeners = new Set<() => void>();

/**
 * Changes the active account only after clearing prior-account in-memory visibility. Durable
 * drafts remain hidden in their one-way partition until explicit return or discard.
 */
export function switchAccount(
  next: AccountPartition | null,
  queryClient: QueryClient,
  status: "unauthenticated" | "unavailable" = "unauthenticated",
): void {
  if (next === null && sessionState.status === status) return;
  if (
    next !== null &&
    sessionState.status === "authenticated" &&
    sessionState.account.accountId === next.accountId
  )
    return;

  void queryClient.cancelQueries();
  queryClient.clear();
  sessionState =
    next === null
      ? { status, account: null }
      : { status: "authenticated", account: next };
  for (const listener of listeners) listener();
}

export function currentAccountPartition(): AccountPartition | null {
  return sessionState.account;
}

/** Resets module state for isolated tests; never called by application code. */
export function resetAccountSessionForTests(): void {
  sessionState = loadingState;
  for (const listener of listeners) listener();
}

/** Hydrates client account state through the protected, live Appwrite-backed API route. */
export function AccountSessionProvider({
  children,
  queryClient,
}: Readonly<{ children: ReactNode; queryClient: QueryClient }>) {
  useEffect(() => {
    let active = true;
    void apiRequest<AuthenticatedSession>("/api/v1/auth/session")
      .then((session) => {
        if (active)
          switchAccount({ accountId: session.accountId }, queryClient);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const unauthenticated =
          error instanceof ApiProblemError &&
          error.problem.code === "AUTH_REQUIRED";
        switchAccount(
          null,
          queryClient,
          unauthenticated ? "unauthenticated" : "unavailable",
        );
      });
    return () => {
      active = false;
    };
  }, [queryClient]);

  return children;
}

/** Reactive account session for protected client routes. */
export function useAccountSession(): AccountSessionState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sessionState,
    () => loadingState,
  );
}

/** Reactive account capability for authenticated client routes. */
export function useAccountPartition(): AccountPartition | null {
  return useAccountSession().account;
}
