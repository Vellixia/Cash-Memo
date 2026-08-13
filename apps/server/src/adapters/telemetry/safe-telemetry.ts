export const safeTelemetryEvents = [
  "auth.operation",
  "capture.operation",
  "deletion.operation",
  "export.operation",
  "privacy.operation",
  "provider.operation",
  "reporting.operation",
  "search.operation",
] as const;

export const safeTelemetryStatuses = [
  "blocked",
  "failed",
  "retried",
  "succeeded",
  "unavailable",
] as const;
export const safeTelemetryReasons = [
  "availability",
  "conflict",
  "invalid_input",
  "privacy_boundary",
  "rate_limited",
  "timeout",
  "unauthorized",
] as const;

export interface SafeTelemetryRecord {
  readonly count: number;
  readonly durationClass: "instant" | "short" | "medium" | "long";
  readonly event: (typeof safeTelemetryEvents)[number];
  readonly reason: (typeof safeTelemetryReasons)[number] | null;
  readonly status: (typeof safeTelemetryStatuses)[number];
}

export interface SafeTelemetrySink {
  emit(record: Readonly<SafeTelemetryRecord>): void;
}

export class SafeTelemetry {
  constructor(private readonly sink: SafeTelemetrySink) {}

  emit(record: Readonly<SafeTelemetryRecord>): void {
    if (
      Object.keys(record).sort().join(",") !== "count,durationClass,event,reason,status" ||
      !Number.isSafeInteger(record.count) ||
      record.count < 0 ||
      !safeTelemetryEvents.includes(record.event) ||
      !safeTelemetryStatuses.includes(record.status) ||
      (record.reason !== null && !safeTelemetryReasons.includes(record.reason)) ||
      !["instant", "short", "medium", "long"].includes(record.durationClass)
    )
      throw new Error("UNSAFE_TELEMETRY_RECORD");
    this.sink.emit(
      Object.freeze({
        count: record.count,
        durationClass: record.durationClass,
        event: record.event,
        reason: record.reason,
        status: record.status,
      }),
    );
  }

  static mapError(error: unknown): NonNullable<SafeTelemetryRecord["reason"]> {
    if (!(error instanceof Error)) return "availability";
    if (/timeout/iu.test(error.name)) return "timeout";
    if (/rate/iu.test(error.name)) return "rate_limited";
    if (/validation/iu.test(error.name)) return "invalid_input";
    return "availability";
  }
}
