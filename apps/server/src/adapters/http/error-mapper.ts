import type { Error as ProductErrorResponse } from "@cashmemo/contracts";
import { ProductError, type ProductErrorCode } from "@cashmemo/domain";

const statusByCode = {
  AUDIO_INVALID: 400,
  AUTH_ACTION_INVALID: 400,
  AUTH_FAILED: 401,
  CALCULATION_UNAVAILABLE: 503,
  CAPABILITY_UNAVAILABLE: 503,
  EMAIL_NOT_VERIFIED: 403,
  EXPORT_NOT_READY: 409,
  FORBIDDEN: 403,
  IDEMPOTENCY_CONFLICT: 409,
  LABEL_CONFLICT: 409,
  NOT_FOUND: 404,
  OPERATION_IN_PROGRESS: 409,
  PRIVACY_BOUNDARY_BLOCKED: 422,
  RATE_LIMITED: 429,
  REAUTH_REQUIRED: 401,
  RESULTS_CHANGED: 409,
  REVISION_CONFLICT: 409,
  STATE_CONFLICT: 409,
  UNAUTHENTICATED: 401,
  VALIDATION_FAILED: 400,
} as const satisfies Record<ProductErrorCode, number>;

interface HttpProductError {
  readonly body: Readonly<ProductErrorResponse>;
  readonly headers: Readonly<Record<string, string>>;
  readonly statusCode: number;
}

class UnsafeErrorMappingAttempt extends Error {
  constructor() {
    super("Only a validated ProductError can cross the public error boundary.");
    this.name = "UnsafeErrorMappingAttempt";
  }
}

function mapProductError(error: unknown, correlationId: string): HttpProductError {
  if (!(error instanceof ProductError) || !isUuid(correlationId)) {
    throw new UnsafeErrorMappingAttempt();
  }

  const body: ProductErrorResponse = {
    code: error.code,
    correlationId,
    currentResultSetVersion: error.currentResultSetVersion,
    currentRevision: error.currentRevision,
    fieldErrors: error.fieldErrors.map((fieldError) => ({
      field: fieldError.field,
      reason: fieldError.reason,
    })),
    messageCode: error.messageCode,
    restartRequired: error.restartRequired,
    retryable: error.retryable,
    retryAfterSeconds: error.retryAfterSeconds,
  };
  const headers =
    error.retryAfterSeconds === null ? {} : { "Retry-After": String(error.retryAfterSeconds) };

  return Object.freeze({
    body: Object.freeze(body),
    headers: Object.freeze(headers),
    statusCode: statusByCode[error.code],
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

export { UnsafeErrorMappingAttempt, mapProductError, statusByCode, type HttpProductError };
