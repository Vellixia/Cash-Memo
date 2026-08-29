import { describe, expect, it } from "vitest";

import { createNoStoreFetch } from "../lib/cache/policy";
import { api } from "../lib/api/axios";

describe("authenticated cache policy", () => {
  it("adds no-store directives to authenticated fetches", async () => {
    let received: RequestInit | undefined;
    const fetcher = createNoStoreFetch((_input, init) => {
      received = init;
      return Promise.resolve(new Response("ok"));
    });

    await fetcher("/api/v1/history");

    expect(received?.cache).toBe("no-store");
    expect(new Headers(received?.headers).get("cache-control")).toBe("no-store");
  });

  it("keeps authenticated API requests cookie-only and uncached", () => {
    expect(api.defaults.withCredentials).toBe(true);
    expect((api.defaults.headers as Record<string, unknown>)["Cache-Control"]).toBe("no-store");
    expect((api.defaults.headers as Record<string, unknown>).Pragma).toBe("no-cache");
  });

  it("keeps service worker policy static-only", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("public/sw.js", "utf8"),
    );

    expect(source).toContain("/api/");
    expect(source).toContain('request.destination === "document"');
    expect(source).toContain("CACHEABLE_ASSET");
    expect(source).not.toContain("/app/");
    expect(source).not.toContain("networkFirst");
  });
});

async function loadHeaderEntries() {
  const { default: nextConfig } = await import("../next.config");
  const { headers } = nextConfig;
  if (!headers) throw new Error("next.config must declare response headers");
  return headers();
}

describe("token page response policy", () => {
  it("sends exactly Referrer-Policy: no-referrer for fragment token pages", async () => {
    const entries = await loadHeaderEntries();
    const bySource = new Map(entries.map((entry) => [entry.source, entry.headers]));

    for (const source of ["/verify-email", "/reset-password"]) {
      expect(bySource.get(source)).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
  });

  it("keeps authenticated no-store rules and leaves unrelated public pages on normal policy", async () => {
    const entries = await loadHeaderEntries();
    const bySource = new Map(entries.map((entry) => [entry.source, entry.headers]));

    for (const source of ["/app/:path*", "/deletion/:path*", "/api/v1/:path*"]) {
      const headers = bySource.get(source);
      expect(headers).toBeDefined();
      expect(headers).toEqual(
        expect.arrayContaining([
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
        ]),
      );
    }

    for (const source of ["/login", "/register", "/forgot-password", "/", "/:path*"]) {
      expect(bySource.has(source)).toBe(false);
    }
  });

  it("keeps fragment token pages free of third-party content", async () => {
    const fs = await import("node:fs/promises");
    // Every file a token page actually renders, including the stylesheet and the UI primitives.
    const tokenPageFiles = [
      "app/layout.tsx",
      "app/globals.css",
      "app/(public)/layout.tsx",
      "app/(public)/verify-email/page.tsx",
      "app/(public)/reset-password/page.tsx",
      "features/auth/forms.tsx",
      "components/ui/card.tsx",
      "components/ui/alert.tsx",
      "components/ui/field.tsx",
      "components/ui/input.tsx",
      "components/ui/button.tsx",
    ];
    const sources = await Promise.all(tokenPageFiles.map((path) => fs.readFile(path, "utf8")));

    for (const [index, source] of sources.entries()) {
      expect(source, tokenPageFiles[index]).not.toMatch(/https?:\/\/(?!localhost)/);
    }
  });

  it("never persists auth tokens in web storage helpers", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("features/auth/forms.tsx", "utf8");

    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
    expect(source).toContain("history.replaceState");
  });
});
