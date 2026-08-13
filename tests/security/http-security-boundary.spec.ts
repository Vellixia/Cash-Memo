import { describe, expect, it } from "vitest";
import {
  allowedOrigins,
  privateSecurityHeaders,
  requireSameOrigin,
  secureDownloadHeaders,
} from "../../apps/server/src/adapters/http/security-boundary.js";
const production = { appOrigin: "https://cashmemo.example", environment: "production" as const };
describe("HTTP security boundary", () => {
  it("accepts same-origin and blocks cross-origin or missing Origin state changes", () => {
    expect(
      requireSameOrigin({
        configuration: production,
        method: "POST",
        origin: production.appOrigin,
      }),
    ).toBe("allowed");
    expect(
      requireSameOrigin({
        configuration: production,
        method: "POST",
        origin: "https://attacker.invalid",
      }),
    ).toBe("blocked");
    expect(
      requireSameOrigin({ configuration: production, method: "DELETE", origin: undefined }),
    ).toBe("blocked");
  });
  it("does not permit localhost in production", () => {
    expect(allowedOrigins(production)).toEqual([production.appOrigin]);
    expect(() =>
      allowedOrigins({ appOrigin: "http://localhost:3000", environment: "production" }),
    ).toThrow("PRODUCTION_ORIGIN_INVALID");
  });
  it("allows explicit localhost only locally", () => {
    expect(allowedOrigins({ appOrigin: "https://localhost:5173", environment: "local" })).toContain(
      "http://localhost:5173",
    );
  });
  it("sets CSP, HSTS, clickjacking, referrer, MIME, and private cache policy", () => {
    const headers = privateSecurityHeaders(true);
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers).toMatchObject({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    expect(headers["Strict-Transport-Security"]).toContain("max-age");
  });
  it("uses fixed safe download policy", () => {
    expect(secureDownloadHeaders("cashmemo-export.zip")).toMatchObject({
      "Content-Disposition": 'attachment; filename="cashmemo-export.zip"',
      "Content-Type": "application/zip",
    });
  });
});
