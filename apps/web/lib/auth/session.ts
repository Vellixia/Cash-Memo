import type { QueryClient } from "@tanstack/react-query";
import type { AccountDeletionContract } from "../../generated/api/model/accountDeletionContract";

const FALLBACK_RETURN_PATH = "/app";
const DESTRUCTIVE_PATH = /(?:delete|deletion|purge|logout|sign-out)/i;
export const SESSION_ACCESS_DELETION_ONLY = "DELETION_ONLY" as const;
export const SESSION_ACCESS_FULL = "FULL" as const;

/** Only allow same-origin, non-action paths through auth redirects. */
export function isSafeReturnPath(value: string | null | undefined): value is string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return false;
  }

  let hasControlCharacter = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) { hasControlCharacter = true; break; }
  }
  if (hasControlCharacter || DESTRUCTIVE_PATH.test(value)) {
    return false;
  }

  try {
    const url = new URL(value, "https://cashmemo.invalid");
    return url.origin === "https://cashmemo.invalid" && url.pathname.startsWith("/");
  } catch {
    return false;
  }
}

export function getSafeReturnPath(value: string | null | undefined): string {
  return isSafeReturnPath(value) ? value : FALLBACK_RETURN_PATH;
}

export function getPostLoginPath(access: string | undefined, returnPath: string | null | undefined): string {
  return access === SESSION_ACCESS_DELETION_ONLY
    ? "/deletion"
    : access === SESSION_ACCESS_FULL
      ? getSafeReturnPath(returnPath)
      : "/login";
}

export function isPendingDeletionStatus(
  status: AccountDeletionContract["status"],
): boolean {
  return status === "pending_deletion";
}

export function deletionActionsForStatus(
  status: AccountDeletionContract["status"],
): { canCancel: boolean; signOutOnly: boolean } {
  return { canCancel: isPendingDeletionStatus(status), signOutOnly: true };
}

/** Fail closed for every deletion-status error; never render private fallback content. */
export function getDeletionErrorDestination(error: unknown): "/login" {
  void error;
  return "/login";
}

export function clearSessionState(queryClient: QueryClient): void {
  // Query cache is memory-only. Clear before navigation so protected data cannot flash.
  queryClient.clear();
}
