import type { SafeTelemetrySignal, TelemetrySink } from "./resilient-exporter.js";

const normalizeMetricsEndpoint = (endpoint: string): string => {
  const url = new URL(endpoint);
  if (!url.pathname.endsWith("/v1/metrics")) {
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/metrics`;
  }
  return url.toString();
};

/**
 * Minimal OTLP/HTTP JSON metrics sink. The payload is constructed from the closed
 * SafeTelemetrySignal union; no request, error, account, or financial value can enter it.
 */
export class OtlpHttpTelemetrySink implements TelemetrySink {
  private readonly endpoint: string;

  constructor(
    endpoint: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.endpoint = normalizeMetricsEndpoint(endpoint);
  }

  async export(signals: readonly SafeTelemetrySignal[]): Promise<void> {
    const timeUnixNano = (BigInt(Date.now()) * 1_000_000n).toString();
    const metrics = signals.map((signal) => ({
      name: `cashmemo.${signal.name}`,
      sum: {
        aggregationTemporality: 1,
        dataPoints: [{ asInt: String(signal.count), timeUnixNano }],
        isMonotonic: false,
      },
    }));
    const response = await this.fetchImplementation(this.endpoint, {
      body: JSON.stringify({
        resourceMetrics: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: "cashmemo-server" } }],
            },
            scopeMetrics: [{ metrics, scope: { name: "cashmemo.safe-telemetry" } }],
          },
        ],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("TELEMETRY_EXPORT_UNAVAILABLE");
  }
}
