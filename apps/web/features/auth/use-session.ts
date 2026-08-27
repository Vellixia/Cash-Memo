"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  currentSession,
  getCurrentSessionQueryKey,
  useCurrentSession,
  useLogout,
} from "../../generated/api";
import { clearSessionState, getSafeReturnPath } from "../../lib/auth/session";

/**
 * Session lookup for gates. Cache clearing belongs to the gate that owns the decision, so this
 * hook never clears the cache it is reading from; that would refetch, error, and clear again.
 */
export function useSession() {
  return useCurrentSession({ query: { retry: false, refetchOnWindowFocus: false } });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const logout = useLogout();

  return async function signOut(returnPath?: string) {
    try {
      await logout.mutateAsync();
    } finally {
      clearSessionState(queryClient);
      router.replace(`/login?returnTo=${encodeURIComponent(getSafeReturnPath(returnPath))}`);
    }
  };
}

export { currentSession, getCurrentSessionQueryKey };
