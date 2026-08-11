import { describe, expect, it, vi } from "vitest";

import { ResilientTelemetryExporter } from "../../src/adapters/telemetry/resilient-exporter.js";

describe("resilient telemetry exporter", () => {
  it("does not await telemetry before journal operation completes", async () => {
    let release: (() => void) | undefined;
    const exporter = new ResilientTelemetryExporter({
      batchSize: 1,
      maxLatencyMs: 1_000,
      maxQueueSize: 2,
      sink: { export: () => new Promise<void>((resolve) => (release = resolve)) },
    });
    const committed = true;
    exporter.record({ count: 1, name: "operation_completed" });
    expect(committed).toBe(true);
    release?.();
    await exporter.flush();
  });

  it("drops failed batches and exposes content-free counters", async () => {
    const exporter = new ResilientTelemetryExporter({
      batchSize: 2,
      maxLatencyMs: 20,
      maxQueueSize: 2,
      sink: { export: vi.fn(() => Promise.reject(new Error("offline"))) },
    });
    exporter.record({ count: 1, name: "operation_completed" });
    exporter.record({ count: 1, name: "operation_failed" });
    await exporter.flush();
    expect(exporter.health()).toEqual({ dropped: 2, failedBatches: 1, queued: 0, succeeded: 0 });
  });

  it("bounds queue growth under backpressure", () => {
    const exporter = new ResilientTelemetryExporter({
      batchSize: 1,
      maxLatencyMs: 1_000,
      maxQueueSize: 2,
      sink: { export: () => new Promise<void>(() => undefined) },
    });
    for (let index = 0; index < 20; index += 1)
      exporter.record({ count: 1, name: "capability_degraded" });
    expect(exporter.health().queued).toBeLessThanOrEqual(2);
    expect(exporter.health().dropped).toBeGreaterThan(0);
  });

  it("rejects non-counter values and has no disk or payload queue API", () => {
    const exporter = new ResilientTelemetryExporter({
      batchSize: 1,
      maxLatencyMs: 20,
      maxQueueSize: 1,
      sink: { export: () => Promise.resolve() },
    });
    expect(() => {
      exporter.record({ count: Number.NaN, name: "operation_failed" });
    }).toThrow("INVALID_TELEMETRY_COUNTER");
    expect(Object.keys(exporter)).not.toContain("diskSpool");
  });
});
