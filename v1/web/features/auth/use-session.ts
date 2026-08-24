"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { currentSession, getCurrentSessionQueryKey, useCurrentSession, useLogout } from "../../generated/api";
import { clearSessionState, getSafeReturnPath } from "../../lib/auth/session";

export function useSession() {
  const query = useCurrentSession({ query: { retry: false } });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (query.error) {
      clearSessionState(queryClient);
    }
  }, [query.error, queryClient]);

  return query;
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
