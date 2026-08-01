"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export type AccountPartition = Readonly<{ accountId: string }>;

let activeAccountId: string | null = null;
const listeners = new Set<() => void>();

/**
 * Changes the active account only after clearing prior-account in-memory visibility. Durable
 * drafts remain hidden in their one-way partition until explicit return or discard.
 */
export async function switchAccount(
  next: AccountPartition | null,
  queryClient: QueryClient,
  hideComposePartition: (accountId: string) => Promise<void>,
): Promise<void> {
  const previous = activeAccountId;
  if (previous === next?.accountId) return;

  queryClient.cancelQueries();
  queryClient.clear();
  if (previous !== null) await hideComposePartition(previous);
  activeAccountId = next?.accountId ?? null;
  for (const listener of listeners) listener();
}

export function currentAccountPartition(): AccountPartition | null {
  return activeAccountId === null ? null : { accountId: activeAccountId };
}

/** Reactive account capability for authenticated client routes. */
export function useAccountPartition(): AccountPartition | null {
  const accountId = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => activeAccountId,
    () => null,
  );
  return accountId === null ? null : { accountId };
}
