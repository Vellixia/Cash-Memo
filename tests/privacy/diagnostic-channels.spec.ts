import { describe, expect, it } from "vitest";

import {
  PrivacyCanaryLeakError,
  scanPrivacyCanaries,
  syntheticPrivacyCanaries,
  type PrivacyCanaryChannel,
} from "@cashmemo/test-support";
import { SafeTelemetry } from "../../apps/server/src/adapters/telemetry/safe-telemetry.js";
import { emitSafeClientDiagnostic } from "../../apps/web/src/privacy/safe-client-diagnostics.js";

const channels: readonly PrivacyCanaryChannel[] = [
  "logs",
  "traces",
  "metrics",
  "product_error",
  "urls",
  "evidence",
  "job_error",
  "browser_diagnostics",
  "provider_metadata",
  "support",
];
const paths = [
  "success",
  "validation_failure",
  "privacy_rejection",
  "retry",
  "provider_failure",
  "invalid_schema",
  "export",
  "deletion",
  "purge_failure",
  "crash",
  "db_failure",
  "network_loss",
] as const;

describe("diagnostic privacy canary execution", () => {
  it.each(paths)("scans every diagnostic channel after %s", (path) => {
    const surfaces = channels.map((channel) => ({
      channel,
      content: `event=${path};status=fixed`,
      locationClass: `${path}.fixed`,
    }));
    expect(scanPrivacyCanaries(surfaces).filter((result) => result.result === "fail")).toHaveLength(
      0,
    );
  });

  it("fails closed without reprinting leaked marker", () => {
    const marker = syntheticPrivacyCanaries[0].marker;
    let thrown: unknown;
    try {
      scanPrivacyCanaries([{ channel: "logs", content: marker, locationClass: "server" }]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PrivacyCanaryLeakError);
    expect(String(thrown)).not.toContain(marker);
  });

  it("safe telemetry accepts fixed typed fields only", () => {
    const records: unknown[] = [];
    new SafeTelemetry({ emit: (record) => records.push(record) }).emit({
      count: 1,
      durationClass: "short",
      event: "privacy.operation",
      reason: "privacy_boundary",
      status: "blocked",
    });
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0] as object).sort()).toEqual([
      "count",
      "durationClass",
      "event",
      "reason",
      "status",
    ]);
  });

  it("client diagnostics accept fixed typed fields only", () => {
    const records: unknown[] = [];
    emitSafeClientDiagnostic(
      { emit: (record) => records.push(record) },
      { count: 1, event: "network.failure", reason: "network" },
    );
    expect(records).toEqual([{ count: 1, event: "network.failure", reason: "network" }]);
  });

  it("rejects runtime-cast arbitrary diagnostic objects", () => {
    const server = new SafeTelemetry({ emit: () => undefined });
    expect(() => {
      server.emit({
        count: 1,
        durationClass: "short",
        event: "privacy.operation",
        reason: null,
        requestBody: "forbidden",
        status: "failed",
      } as never);
    }).toThrow();
    expect(() => {
      emitSafeClientDiagnostic({ emit: () => undefined }, {
        count: 1,
        event: "network.failure",
        reason: "network",
        url: "forbidden",
      } as never);
    }).toThrow();
  });
});
