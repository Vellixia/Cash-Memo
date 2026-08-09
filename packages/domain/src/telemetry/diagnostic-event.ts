const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BUILD_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;

export const diagnosticOperationCodes = [
  "http.request",
  "auth.signup",
  "auth.login",
  "auth.verify",
  "auth.reset",
  "session.refresh",
  "session.revoke",
  "preferences.update",
  "memo.create",
  "memo.read",
  "memo.update",
  "memo.lifecycle",
  "draft.save",
  "draft.cleanup",
  "capture.stt",
  "capture.extraction",
  "capture.cleanup",
  "history.list",
  "search.execute",
  "overview.calculate",
  "review.calculate",
  "export.build",
  "export.delete",
  "account.delete",
  "provider.delete",
  "restore.reconcile",
  "privacy.control",
  "worker.run",
  "database.query",
  "pwa.client",
] as const;
export const diagnosticOutcomes = [
  "success",
  "rejected",
  "conflict",
  "unavailable",
  "retry",
  "timeout",
  "invalid",
  "failure",
] as const;
export const durationBuckets = [
  "lt_50ms",
  "lt_250ms",
  "lt_1s",
  "lt_5s",
  "lt_30s",
  "gte_30s",
] as const;
export const serviceHealthStates = ["healthy", "degraded", "unavailable", "unknown"] as const;
export const queueDepthBuckets = ["empty", "low", "medium", "high", "critical"] as const;
export const retryCountBuckets = ["zero", "one", "two", "three_or_more"] as const;

export type DiagnosticOperationCode = (typeof diagnosticOperationCodes)[number];
export type DiagnosticOutcome = (typeof diagnosticOutcomes)[number];
export type DurationBucket = (typeof durationBuckets)[number];
export type ServiceHealthState = (typeof serviceHealthStates)[number];
export type QueueDepthBucket = (typeof queueDepthBuckets)[number];
export type RetryCountBucket = (typeof retryCountBuckets)[number];

export interface DiagnosticEventInput {
  readonly buildVersion: string;
  readonly correlationId: string;
  readonly durationBucket: DurationBucket;
  readonly operation: DiagnosticOperationCode;
  readonly outcome: DiagnosticOutcome;
  readonly queueDepthBucket?: QueueDepthBucket;
  readonly retryCountBucket?: RetryCountBucket;
  readonly serviceHealth: ServiceHealthState;
}

export type DiagnosticEvent = Readonly<DiagnosticEventInput>;

type ExactDiagnosticInput<T extends DiagnosticEventInput> = T &
  Record<Exclude<keyof T, keyof DiagnosticEventInput>, never>;

const allowedKeys = new Set<keyof DiagnosticEventInput>([
  "buildVersion",
  "correlationId",
  "durationBucket",
  "operation",
  "outcome",
  "queueDepthBucket",
  "retryCountBucket",
  "serviceHealth",
]);

export class DiagnosticEventValidationError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid diagnostic event: ${reason}`);
    this.name = "DiagnosticEventValidationError";
  }
}

function isMember<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.some((allowed) => allowed === value);
}

export function buildDiagnosticEvent<const T extends DiagnosticEventInput>(
  input: ExactDiagnosticInput<T>,
): DiagnosticEvent {
  if (Object.getPrototypeOf(input) !== Object.prototype) {
    throw new DiagnosticEventValidationError("non_plain_input");
  }
  const ownKeys = Reflect.ownKeys(input);
  if (
    ownKeys.some(
      (key) => typeof key !== "string" || !allowedKeys.has(key as keyof DiagnosticEventInput),
    )
  ) {
    throw new DiagnosticEventValidationError("non_allowlisted_field");
  }
  if (Object.keys(input).length !== ownKeys.length) {
    throw new DiagnosticEventValidationError("hidden_field");
  }
  if (!BUILD_VERSION_PATTERN.test(input.buildVersion)) {
    throw new DiagnosticEventValidationError("build_version");
  }
  if (!UUID_PATTERN.test(input.correlationId)) {
    throw new DiagnosticEventValidationError("correlation_id");
  }
  if (!isMember(input.operation, diagnosticOperationCodes)) {
    throw new DiagnosticEventValidationError("operation");
  }
  if (!isMember(input.outcome, diagnosticOutcomes)) {
    throw new DiagnosticEventValidationError("outcome");
  }
  if (!isMember(input.durationBucket, durationBuckets)) {
    throw new DiagnosticEventValidationError("duration_bucket");
  }
  if (!isMember(input.serviceHealth, serviceHealthStates)) {
    throw new DiagnosticEventValidationError("service_health");
  }
  if (
    input.queueDepthBucket !== undefined &&
    !isMember(input.queueDepthBucket, queueDepthBuckets)
  ) {
    throw new DiagnosticEventValidationError("queue_depth_bucket");
  }
  if (
    input.retryCountBucket !== undefined &&
    !isMember(input.retryCountBucket, retryCountBuckets)
  ) {
    throw new DiagnosticEventValidationError("retry_count_bucket");
  }

  return Object.freeze({
    buildVersion: input.buildVersion,
    correlationId: input.correlationId,
    durationBucket: input.durationBucket,
    operation: input.operation,
    outcome: input.outcome,
    ...(input.queueDepthBucket === undefined ? {} : { queueDepthBucket: input.queueDepthBucket }),
    ...(input.retryCountBucket === undefined ? {} : { retryCountBucket: input.retryCountBucket }),
    serviceHealth: input.serviceHealth,
  });
}
