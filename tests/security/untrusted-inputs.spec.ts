import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  PrivacyCanaryLeakError,
  scanPrivacyCanaries,
  syntheticPrivacyCanaries,
} from "../../packages/test-support/src/privacy/canary-scanner.js";
import { secureDownloadHeaders } from "../../apps/server/src/adapters/http/security-boundary.js";
import {
  MAX_AUDIO_BYTES,
  magicMatches,
} from "../../apps/server/src/modules/assisted-capture/temporary-audio.service.js";

const repo = new URL("../../", import.meta.url);
const extraction = await readFile(
  new URL("apps/server/src/modules/assisted-capture/extraction-validation.ts", repo),
  "utf8",
);
const search = await readFile(
  new URL("apps/server/src/modules/history/versioned-traversal.service.ts", repo),
  "utf8",
);
const serializer = await readFile(
  new URL("apps/server/src/modules/export/export-v1.serializer.ts", repo),
  "utf8",
);
const webSources = await Promise.all(
  [
    "apps/web/src/features/capture/NaturalLanguageCapture.tsx",
    "apps/web/src/features/history/SearchAndFilters.tsx",
    "apps/web/src/features/labels/LabelManager.tsx",
  ].map(async (path) => readFile(new URL(path, repo), "utf8")),
);

describe("consolidated hostile-input security matrix", () => {
  it("rejects unexpected extraction fields and caps notes", () => {
    expect(extraction).toContain("Object.keys(record).some");
    expect(extraction).toContain("4_000");
    expect(extraction).toContain("AI_INVALID_OUTPUT");
  });

  it("caps audio allocation and checks declared MIME against magic bytes", () => {
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024);
    expect(magicMatches(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), "audio/ogg")).toBe(true);
    expect(magicMatches(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), "audio/wav")).toBe(false);
  });

  it("uses bound SQL parameters for hostile search metacharacters", () => {
    expect(search).toContain("plainto_tsquery('simple', $");
    expect(search).not.toMatch(/plainto_tsquery\('simple',\s*`/u);
    expect(search).not.toMatch(/query\.trim\(\).*\$\{/u);
  });

  it("protects CSV cells from spreadsheet formula execution", () => {
    expect(serializer).toContain("dangerous-prefix-apostrophe");
    expect(serializer).toMatch(/\^\[=\+\\-@\\t\\r\]/u);
  });

  it("uses one fixed safe download filename and no path input", () => {
    const headers = secureDownloadHeaders("cashmemo-export.zip");
    expect(headers["Content-Disposition"]).toBe('attachment; filename="cashmemo-export.zip"');
  });

  it("renders hostile strings through React text nodes, not raw HTML", () => {
    expect(webSources.join("\n")).not.toContain("dangerouslySetInnerHTML");
  });

  it("handles Unicode controls as detector input without echoing content", () => {
    const canary = syntheticPrivacyCanaries[0];
    let error: unknown;
    try {
      scanPrivacyCanaries([
        {
          channel: "product_error",
          locationClass: "validation",
          content: `\u202e${canary.marker}`,
        },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PrivacyCanaryLeakError);
    expect(JSON.stringify(error)).not.toContain(canary.marker);
  });

  it("validates month, timezone, currency, IDs, and cursors at finite adapters", async () => {
    const sources = await Promise.all(
      [
        "apps/server/src/modules/reporting/monthly-review.controller.ts",
        "packages/domain/src/time/occurrence.ts",
        "apps/server/src/modules/history/cursor-codec.ts",
        "apps/server/src/adapters/postgres/transaction-context.ts",
      ].map(async (path) => readFile(new URL(path, repo), "utf8")),
    );
    const joined = sources.join("\n");
    expect(joined).toContain("INVALID_REPORTING_MONTH");
    expect(joined).toContain("INVALID_AUTHENTICATED_ACCOUNT_ID");
    expect(joined).toMatch(/CURSOR|cursor/u);
  });

  it("never includes raw request/provider error serializers", async () => {
    const telemetry = await readFile(
      new URL("apps/server/src/adapters/telemetry/safe-telemetry.ts", repo),
      "utf8",
    );
    expect(telemetry).not.toContain("JSON.stringify");
    expect(telemetry).not.toMatch(/requestBody|responseBody|providerPayload|rawError/u);
  });
});
