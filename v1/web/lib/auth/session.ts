import type { QueryClient } from "@tanstack/react-query";

const FALLBACK_RETURN_PATH = "/app";
const DESTRUCTIVE_PATH = /(?:delete|deletion|purge|logout|sign-out)/i;

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

export function clearSessionState(queryClient: QueryClient): void {
  // Query cache is memory-only. Clear before navigation so protected data cannot flash.
  queryClient.clear();
}
