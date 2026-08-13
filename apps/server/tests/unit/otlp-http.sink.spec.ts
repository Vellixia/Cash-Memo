import { describe, expect, it, vi } from "vitest";

import { OtlpHttpTelemetrySink } from "../../src/adapters/telemetry/otlp-http.sink.js";

describe("OTLP HTTP safe telemetry sink", () => {
  it("exports only allowlisted aggregate counters to the configured metrics endpoint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const sink = new OtlpHttpTelemetrySink("http://otel-collector:4318", fetchImplementation);

    await sink.export([{ count: 1, name: "operation_completed" }]);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    const body = typeof init?.body === "string" ? init.body : "";
    expect(url).toBe("http://otel-collector:4318/v1/metrics");
    expect(init?.method).toBe("POST");
    expect(body).toContain("cashmemo.operation_completed");
    expect(body).not.toMatch(/requestBody|responseBody|accountId|memoContent|amount|email/iu);
  });

  it("maps non-success transport responses to a fixed content-free error", async () => {
    const sink = new OtlpHttpTelemetrySink("http://otel-collector:4318/v1/metrics", () =>
      Promise.resolve(new Response("PRIVATE_CANARY", { status: 503 })),
    );

    await expect(sink.export([{ count: 1, name: "operation_failed" }])).rejects.toThrow(
      "TELEMETRY_EXPORT_UNAVAILABLE",
    );
  });
});
