import * as Sentry from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend } from "@/lib/sentry-filters";

/** Browser init. A complete no-op when NEXT_PUBLIC_SENTRY_DSN is unset (tests/dev): nothing below runs.
 * Replay isn't in the SDK's default integrations, so leaving it out of `integrations` is enough to keep it off. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    // No `sendDefaultPii` in this SDK major (see instrumentation.ts); beforeSend strips request PII anyway.
    tracesSampleRate: 0,
    beforeSend,
    beforeBreadcrumb,
  });
}
