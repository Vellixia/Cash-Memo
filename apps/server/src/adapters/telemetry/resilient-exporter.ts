export type SafeTelemetryCounter =
  "export_dropped" | "export_failed" | "export_succeeded" | "queue_full";

export interface SafeTelemetrySignal {
  readonly count: number;
  readonly name: "capability_degraded" | "operation_completed" | "operation_failed";
}

export interface TelemetryHealth {
  readonly dropped: number;
  readonly failedBatches: number;
  readonly queued: number;
  readonly succeeded: number;
}

export interface TelemetrySink {
  export(signals: readonly SafeTelemetrySignal[]): Promise<void>;
}

const SAFE_SIGNAL_NAMES = [
  "capability_degraded",
  "operation_completed",
  "operation_failed",
] as const;

/** Non-blocking, memory-bounded exporter for allowlisted content-free counters only. */
export class ResilientTelemetryExporter {
  private readonly queue: SafeTelemetrySignal[] = [];
  private draining = false;
  private dropped = 0;
  private failedBatches = 0;
  private succeeded = 0;

  constructor(
    private readonly options: {
      readonly batchSize: number;
      readonly maxLatencyMs: number;
      readonly maxQueueSize: number;
      readonly sink: TelemetrySink;
    },
  ) {
    if (
      options.batchSize < 1 ||
      options.maxLatencyMs < 1 ||
      options.maxQueueSize < options.batchSize
    ) {
      throw new Error("INVALID_TELEMETRY_BOUNDS");
    }
  }

  record(signal: SafeTelemetrySignal): void {
    if (
      !Number.isSafeInteger(signal.count) ||
      signal.count < 0 ||
      !SAFE_SIGNAL_NAMES.includes(signal.name)
    )
      throw new Error("INVALID_TELEMETRY_COUNTER");
    if (this.queue.length >= this.options.maxQueueSize) {
      this.dropped += 1;
      return;
    }
    this.queue.push(Object.freeze({ ...signal }));
    queueMicrotask(() => {
      void this.drain();
    });
  }

  health(): TelemetryHealth {
    return Object.freeze({
      dropped: this.dropped,
      failedBatches: this.failedBatches,
      queued: this.queue.length,
      succeeded: this.succeeded,
    });
  }

  async flush(): Promise<void> {
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;
    const batch = this.queue.splice(0, this.options.batchSize);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.options.sink.export(batch),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error("TELEMETRY_EXPORT_TIMEOUT"));
          }, this.options.maxLatencyMs);
        }),
      ]);
      this.succeeded += batch.length;
    } catch {
      this.failedBatches += 1;
      this.dropped += batch.length;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.draining = false;
      if (this.queue.length > 0)
        queueMicrotask(() => {
          void this.drain();
        });
    }
  }
}
