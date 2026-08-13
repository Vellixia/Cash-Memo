export const clientDiagnosticEvents = [
  "capture.failure",
  "network.failure",
  "privacy.blocked",
  "session.expired",
] as const;

export interface SafeClientDiagnostic {
  readonly count: number;
  readonly event: (typeof clientDiagnosticEvents)[number];
  readonly reason: "invalid_input" | "network" | "privacy_boundary" | "unauthorized";
}

export interface SafeClientDiagnosticSink {
  emit(record: Readonly<SafeClientDiagnostic>): void;
}

export function emitSafeClientDiagnostic(
  sink: SafeClientDiagnosticSink,
  record: Readonly<SafeClientDiagnostic>,
): void {
  if (
    Object.keys(record).sort().join(",") !== "count,event,reason" ||
    !Number.isSafeInteger(record.count) ||
    record.count < 0 ||
    !clientDiagnosticEvents.includes(record.event) ||
    !["invalid_input", "network", "privacy_boundary", "unauthorized"].includes(record.reason)
  )
    throw new Error("UNSAFE_DIAGNOSTIC_RECORD");
  sink.emit(Object.freeze({ count: record.count, event: record.event, reason: record.reason }));
}
