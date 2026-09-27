import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/** Query strings can carry single-use tokens (/reset?token=…, /confirm-email?token=…). */
const stripQuery = (url: unknown) => (typeof url === "string" ? url.split("?")[0] : url);

/** Strips request cookies/headers/query/data (and the query in the URL) before an event leaves the
 * browser or server. Shared by instrumentation.ts (server/edge) and instrumentation-client.ts (browser). */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    delete event.request.data;
    event.request.url = stripQuery(event.request.url) as string | undefined;
  }
  return event;
}

/** Drops query strings from fetch/xhr URLs and navigation from/to. */
export function beforeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  if (!data) return breadcrumb;
  if (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") data.url = stripQuery(data.url);
  if (breadcrumb.category === "navigation") {
    data.from = stripQuery(data.from);
    data.to = stripQuery(data.to);
  }
  return breadcrumb;
}
