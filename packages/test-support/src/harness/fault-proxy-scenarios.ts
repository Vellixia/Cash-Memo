export type FaultProxyScenarioId =
  | "connection_kill"
  | "connection_reset"
  | "delayed_response"
  | "duplicate_delivery"
  | "invalid_body"
  | "lost_response"
  | "partial_body"
  | "rate_limit"
  | "timeout";

export type FaultCommitState = "committed" | "not_committed" | "unknown";

export interface FaultProxyMetadata {
  readonly attempt: number;
  readonly commitState: FaultCommitState;
  readonly faultId: FaultProxyScenarioId;
  readonly operation: string;
}

export class FaultProxyError extends Error {
  constructor(
    readonly faultId: FaultProxyScenarioId,
    readonly commitState: FaultCommitState,
    readonly retryable: boolean,
  ) {
    super("CONTROLLED_FAULT");
    this.name = "FaultProxyError";
  }
}

export interface FaultExecution<T> {
  readonly commit: () => Promise<T>;
  readonly identity: string;
  readonly operation: string;
  readonly scenario: FaultProxyScenarioId;
}

/** Test-only deterministic proxy. It records coarse metadata, never request/response payloads. */
export class DeterministicFaultProxy {
  readonly metadata: FaultProxyMetadata[] = [];
  private readonly attempts = new Map<string, number>();

  async execute<T>(execution: FaultExecution<T>): Promise<T> {
    const key = `${execution.operation}:${execution.identity}:${execution.scenario}`;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);

    if (execution.scenario === "duplicate_delivery") {
      const result = await execution.commit();
      await execution.commit();
      this.record(execution, attempt, "committed");
      return result;
    }
    if (execution.scenario === "lost_response") {
      await execution.commit();
      this.record(execution, attempt, "committed");
      throw new FaultProxyError("lost_response", "committed", true);
    }
    if (execution.scenario === "delayed_response") {
      const result = await execution.commit();
      await Promise.resolve();
      this.record(execution, attempt, "committed");
      return result;
    }
    if (execution.scenario === "invalid_body" || execution.scenario === "partial_body") {
      this.record(execution, attempt, "not_committed");
      throw new FaultProxyError(execution.scenario, "not_committed", false);
    }
    if (execution.scenario === "rate_limit" || execution.scenario === "timeout") {
      this.record(execution, attempt, "not_committed");
      throw new FaultProxyError(execution.scenario, "not_committed", true);
    }
    if (execution.scenario === "connection_kill") {
      this.record(execution, attempt, "unknown");
      throw new FaultProxyError("connection_kill", "unknown", true);
    }
    this.record(execution, attempt, "not_committed");
    throw new FaultProxyError("connection_reset", "not_committed", true);
  }

  private record<T>(
    execution: FaultExecution<T>,
    attempt: number,
    commitState: FaultCommitState,
  ): void {
    this.metadata.push(
      Object.freeze({
        attempt,
        commitState,
        faultId: execution.scenario,
        operation: execution.operation,
      }),
    );
  }
}

export const FAULT_PROXY_SCENARIOS: readonly FaultProxyScenarioId[] = Object.freeze([
  "timeout",
  "connection_reset",
  "lost_response",
  "rate_limit",
  "invalid_body",
  "partial_body",
  "delayed_response",
  "connection_kill",
  "duplicate_delivery",
]);
