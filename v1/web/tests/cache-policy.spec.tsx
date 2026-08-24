import { describe, expect, it } from "vitest";

import { createNoStoreFetch } from "../lib/cache/policy";

describe("authenticated cache policy", () => {
  it("adds no-store directives to authenticated fetches", async () => {
    let received: RequestInit | undefined;
    const fetcher = createNoStoreFetch((_input, init) => {
      received = init;
      return Promise.resolve(new Response("ok"));
    });

    await fetcher("/api/v1/history");

    expect(received?.cache).toBe("no-store");
    expect(new Headers(received?.headers).get("cache-control")).toBe(
      "no-store",
    );
  });

  it("keeps service worker policy static-only", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("public/sw.js", "utf8"));

    expect(source).toContain("/api/");
    expect(source).toContain("request.destination === \"document\"");
    expect(source).toContain("CACHEABLE_ASSET");
    expect(source).not.toContain("/app/");
    expect(source).not.toContain("networkFirst");
  });
});
