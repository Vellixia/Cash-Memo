import { expect, test } from "bun:test";
import type { ErrorEvent } from "@sentry/nextjs";
import { beforeBreadcrumb, beforeSend } from "./sentry-filters";

test("events and breadcrumbs never carry tokens or request data", () => {
  const e = beforeSend({
    type: undefined,
    request: { url: "https://x.dev/reset?token=abc", query_string: "token=abc", cookies: { session: "s" }, headers: { a: "b" }, data: "{}" },
  } as ErrorEvent);
  expect(e.request).toEqual({ url: "https://x.dev/reset" });

  expect(beforeBreadcrumb({ category: "navigation", data: { from: "/login", to: "/confirm-email?token=abc" } }).data).toEqual({
    from: "/login",
    to: "/confirm-email",
  });
  expect(beforeBreadcrumb({ category: "fetch", data: { url: "/api/memos?month=2026-09" } }).data?.url).toBe("/api/memos");
});
