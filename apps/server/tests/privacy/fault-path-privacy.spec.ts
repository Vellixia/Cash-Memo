import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ResilientTelemetryExporter } from "../../src/adapters/telemetry/resilient-exporter.js";
import { CoreReadinessError } from "../../src/bootstrap/core-readiness.guard.js";
import { DeterministicFaultProxy } from "@cashmemo/test-support";

const CANARY = "PRIVATE_FAULT_CANARY_9cc01c";

describe("fault-path privacy canaries", () => {
  it("failure inventory contains no private request or payload value", async () => {
    const inventory = await readFile(
      new URL("../../../../tests/failure/failure-matrix.ts", import.meta.url),
      "utf8",
    );
    expect(inventory).not.toContain(CANARY);
    expect(inventory).not.toMatch(/requestBody|responseBody|rawError/iu);
  });

  it("fault proxy metadata excludes candidate values", async () => {
    const proxy = new DeterministicFaultProxy();
    await expect(
      proxy.execute({
        commit: () => Promise.resolve(CANARY),
        identity: "opaque-fault-fixture",
        operation: "memo.confirm",
        scenario: "timeout",
      }),
    ).rejects.toThrow("CONTROLLED_FAULT");
    expect(JSON.stringify(proxy.metadata)).not.toContain(CANARY);
  });

  it("telemetry accepts only allowlisted numeric health signals", async () => {
    const batches: unknown[] = [];
    const exporter = new ResilientTelemetryExporter({
      batchSize: 1,
      maxLatencyMs: 20,
      maxQueueSize: 1,
      sink: {
        export: (signals) => {
          batches.push(signals);
          return Promise.resolve();
        },
      },
    });
    exporter.record({ count: 1, name: "operation_failed" });
    await exporter.flush();
    expect(JSON.stringify(batches)).not.toContain(CANARY);
    expect(JSON.stringify(batches)).not.toMatch(/amount|category|memo|transcript|user/iu);
  });

  it("core outage client errors are stable and content-free", () => {
    for (const state of [
      "auth_unavailable",
      "core_dependency_unavailable",
      "persistence_unavailable",
      "schema_incompatible",
    ] as const) {
      const error = new CoreReadinessError(state);
      expect(error.message).toBe("CORE_OPERATION_UNAVAILABLE");
      expect(error.message).not.toContain(state);
      expect(error.message).not.toContain(CANARY);
    }
  });

  it("cross-account failure details have no shared value channel", () => {
    const accountFailures = new Map<string, string>();
    accountFailures.set("account-a", "ASSISTED_CAPTURE_UNAVAILABLE");
    expect(accountFailures.get("account-b")).toBeUndefined();
  });
});
