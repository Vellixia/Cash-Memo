export type FailureCapability =
  | "ai_extraction"
  | "authentication"
  | "backup_repository"
  | "database"
  | "email_delivery"
  | "network"
  | "object_storage"
  | "reporting"
  | "stt"
  | "telemetry"
  | "worker";

export type VisibleProductState =
  | "assisted_capture_unavailable"
  | "auth_unavailable"
  | "calculation_unavailable"
  | "delivery_pending"
  | "draft_recoverable_unsaved"
  | "manual_journal_available"
  | "operation_pending_reconciliation"
  | "save_unavailable"
  | "telemetry_degraded"
  | "voice_unavailable"
  | "worker_retry_pending";

export interface FailureMatrixEntry {
  readonly authoritativeStateInvariant: string;
  readonly capability: FailureCapability;
  readonly evidenceClassification:
    | "accelerator_degraded"
    | "core_fail_closed"
    | "delivery_degraded"
    | "observability_degraded"
    | "reporting_degraded"
    | "retry_reconciled"
    | "worker_degraded";
  readonly faultId: string;
  readonly injectionPoint: string;
  readonly localRecoveryAllowed: boolean;
  readonly retryAllowed: boolean;
  readonly visibleProductState: VisibleProductState;
}

const entry = (value: FailureMatrixEntry): FailureMatrixEntry => Object.freeze(value);

export const FAILURE_MATRIX: readonly FailureMatrixEntry[] = Object.freeze([
  ...[
    ["timeout", true],
    ["connection_reset", true],
    ["rate_limit", true],
    ["refusal", false],
    ["malformed_result", false],
    ["unavailable", true],
  ].map(([fault, retry]) =>
    entry({
      authoritativeStateInvariant: "confirmed records and revisions remain unchanged",
      capability: "stt",
      evidenceClassification: "accelerator_degraded",
      faultId: `stt.${String(fault)}`,
      injectionPoint: "stt_adapter.transcribe",
      localRecoveryAllowed: true,
      retryAllowed: Boolean(retry),
      visibleProductState: "voice_unavailable",
    }),
  ),
  ...[
    ["timeout", true],
    ["connection_reset", true],
    ["rate_limit", true],
    ["refusal", false],
    ["malformed_schema", false],
    ["partial_result", false],
    ["unavailable", true],
  ].map(([fault, retry]) =>
    entry({
      authoritativeStateInvariant: "partial output never confirms or mutates a Money Memo",
      capability: "ai_extraction",
      evidenceClassification: "accelerator_degraded",
      faultId: `ai.${String(fault)}`,
      injectionPoint: "extraction_adapter.extract",
      localRecoveryAllowed: true,
      retryAllowed: Boolean(retry),
      visibleProductState: "assisted_capture_unavailable",
    }),
  ),
  ...[
    ["offline_before_request", "draft_recoverable_unsaved", true],
    ["connection_lost_during_request", "draft_recoverable_unsaved", true],
    ["successful_response_lost", "operation_pending_reconciliation", true],
    ["duplicate_retry", "operation_pending_reconciliation", true],
    ["app_close_reopen", "draft_recoverable_unsaved", true],
  ].map(([fault, state, retry]) =>
    entry({
      authoritativeStateInvariant:
        fault === "successful_response_lost" || fault === "duplicate_retry"
          ? "same idempotency identity resolves to one authoritative result"
          : "local recovery remains non-authoritative until a successful server transaction",
      capability: "network",
      evidenceClassification: "retry_reconciled",
      faultId: `network.${String(fault)}`,
      injectionPoint: "browser_http_boundary",
      localRecoveryAllowed: true,
      retryAllowed: Boolean(retry),
      visibleProductState: state as VisibleProductState,
    }),
  ),
  ...[
    ["unavailable_before_transaction", "save_unavailable", true],
    ["failure_before_commit", "save_unavailable", true],
    ["commit_succeeded_response_lost", "operation_pending_reconciliation", true],
    ["connection_lost_commit_boundary", "operation_pending_reconciliation", true],
    ["pool_exhausted", "save_unavailable", true],
  ].map(([fault, state, retry]) =>
    entry({
      authoritativeStateInvariant:
        fault === "commit_succeeded_response_lost" || fault === "connection_lost_commit_boundary"
          ? "unknown client outcome is reconciled by idempotency without duplicate authority"
          : "failure before commit creates zero authoritative results",
      capability: "database",
      evidenceClassification:
        state === "save_unavailable" ? "core_fail_closed" : "retry_reconciled",
      faultId: `database.${String(fault)}`,
      injectionPoint: "account_transaction_commit_boundary",
      localRecoveryAllowed: true,
      retryAllowed: Boolean(retry),
      visibleProductState: state as VisibleProductState,
    }),
  ),
  ...["expired_session", "revoked_session", "invalid_session", "dependency_failure"].map((fault) =>
    entry({
      authoritativeStateInvariant: "protected operation is denied with no anonymous fallback",
      capability: "authentication",
      evidenceClassification: "core_fail_closed",
      faultId: `auth.${fault}`,
      injectionPoint: "session_authentication_boundary",
      localRecoveryAllowed: fault === "dependency_failure",
      retryAllowed: fault === "dependency_failure",
      visibleProductState: "auth_unavailable",
    }),
  ),
  ...["temporary_failure", "provider_unavailable", "delivery_failed"].map((fault) =>
    entry({
      authoritativeStateInvariant: "email state never grants identity authority",
      capability: "email_delivery",
      evidenceClassification: "delivery_degraded",
      faultId: `email.${fault}`,
      injectionPoint: "email_delivery_adapter",
      localRecoveryAllowed: false,
      retryAllowed: fault !== "delivery_failed",
      visibleProductState: "delivery_pending",
    }),
  ),
  ...(
    [
      ["object_storage.unavailable", "object_storage"],
      ["object_storage.permission_denied", "object_storage"],
      ["backup_repository.unavailable", "backup_repository"],
      ["backup_repository.encryption_policy_failed", "backup_repository"],
      ["backup_repository.wal_archive_failed", "backup_repository"],
    ] as const
  ).map(([faultId, capability]) =>
    entry({
      authoritativeStateInvariant: "journal authority remains in PostgreSQL and is not fabricated",
      capability,
      evidenceClassification: "delivery_degraded",
      faultId,
      injectionPoint: `${capability}_adapter`,
      localRecoveryAllowed: false,
      retryAllowed: true,
      visibleProductState: "delivery_pending",
    }),
  ),
  ...["unavailable", "slow", "backpressure", "exporter_failure"].map((fault) =>
    entry({
      authoritativeStateInvariant: "telemetry failure never changes or blocks journal authority",
      capability: "telemetry",
      evidenceClassification: "observability_degraded",
      faultId: `telemetry.${fault}`,
      injectionPoint: "telemetry_export_boundary",
      localRecoveryAllowed: false,
      retryAllowed: false,
      visibleProductState: "telemetry_degraded",
    }),
  ),
  ...["crash", "retry", "duplicate_delivery", "lease_expired_reclaim"].map((fault) =>
    entry({
      authoritativeStateInvariant: "duplicate or reclaimed work produces one logical outcome",
      capability: "worker",
      evidenceClassification: "worker_degraded",
      faultId: `worker.${fault}`,
      injectionPoint: "database_job_lease_boundary",
      localRecoveryAllowed: false,
      retryAllowed: true,
      visibleProductState: "worker_retry_pending",
    }),
  ),
  ...["current_month_unavailable", "monthly_review_unavailable"].map((fault) =>
    entry({
      authoritativeStateInvariant: "no stale or partial calculation is returned as current",
      capability: "reporting",
      evidenceClassification: "reporting_degraded",
      faultId: `reporting.${fault}`,
      injectionPoint: "reporting_calculation_boundary",
      localRecoveryAllowed: false,
      retryAllowed: true,
      visibleProductState: "calculation_unavailable",
    }),
  ),
]);

export function validateFailureMatrix(matrix: readonly FailureMatrixEntry[] = FAILURE_MATRIX): {
  readonly capabilities: readonly FailureCapability[];
  readonly faultCount: number;
} {
  const ids = new Set<string>();
  const capabilities = new Set<FailureCapability>();
  for (const item of matrix) {
    if (ids.has(item.faultId)) throw new Error("DUPLICATE_FAILURE_FAULT_ID");
    if (item.faultId.trim() === "" || item.injectionPoint.trim() === "")
      throw new Error("INCOMPLETE_FAILURE_MATRIX_ENTRY");
    if (item.authoritativeStateInvariant.trim() === "")
      throw new Error("MISSING_AUTHORITY_INVARIANT");
    ids.add(item.faultId);
    capabilities.add(item.capability);
  }
  return Object.freeze({ capabilities: [...capabilities].sort(), faultCount: matrix.length });
}
