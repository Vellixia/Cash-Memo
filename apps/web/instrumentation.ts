import * as Sentry from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend } from "@/lib/sentry-filters";

/** Server + edge init. A complete no-op when NEXT_PUBLIC_SENTRY_DSN is unset (tests/dev): `register`
 * just returns, so no client is ever created and later `onRequestError` calls have nothing to report to. */
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    // No `sendDefaultPii` in this SDK major: PII (headers/cookies/IP) is opt-in by default already, and
    // beforeSend below strips it from `event.request` explicitly regardless.
    tracesSampleRate: 0,
    beforeSend,
    beforeBreadcrumb,
  });
}

export const onRequestError = Sentry.captureRequestError;
