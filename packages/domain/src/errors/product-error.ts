const productErrorCodes = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "AUTH_FAILED",
  "EMAIL_NOT_VERIFIED",
  "AUTH_ACTION_INVALID",
  "REAUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "REVISION_CONFLICT",
  "RESULTS_CHANGED",
  "IDEMPOTENCY_CONFLICT",
  "STATE_CONFLICT",
  "LABEL_CONFLICT",
  "PRIVACY_BOUNDARY_BLOCKED",
  "AUDIO_INVALID",
  "CAPABILITY_UNAVAILABLE",
  "CALCULATION_UNAVAILABLE",
  "EXPORT_NOT_READY",
  "RATE_LIMITED",
  "OPERATION_IN_PROGRESS",
] as const;

type ProductErrorCode = (typeof productErrorCodes)[number];

const productFields = [
  "amount",
  "categoryId",
  "confirmation",
  "currency",
  "defaultCurrency",
  "direction",
  "email",
  "expectedRevision",
  "locale",
  "moneySpaceId",
  "note",
  "occurredLocal",
  "offsetMinutes",
  "password",
  "planningStatus",
  "purpose",
  "reportingTimezone",
  "search",
  "timezone",
  "token",
] as const;

type ProductField = (typeof productFields)[number];
const productFieldSet = new Set<string>(productFields);

const fieldErrorReasons = [
  "AMBIGUOUS",
  "CONFLICTING",
  "EXPIRED",
  "INVALID",
  "OUT_OF_RANGE",
  "PRECISION_EXCEEDED",
  "REQUIRED",
  "UNSUPPORTED",
] as const;

type FieldErrorReason = (typeof fieldErrorReasons)[number];
const fieldErrorReasonSet = new Set<string>(fieldErrorReasons);

interface ProductFieldError {
  readonly field: ProductField;
  readonly reason: FieldErrorReason;
}

interface ProductErrorOptions {
  readonly currentResultSetVersion?: string;
  readonly currentRevision?: string;
  readonly fieldErrors?: readonly ProductFieldError[];
  readonly retryAfterSeconds?: number;
}

const errorPolicy = {
  AUDIO_INVALID: { messageCode: "AUDIO_INVALID_REVIEW_REQUIREMENTS", retryable: false },
  AUTH_ACTION_INVALID: { messageCode: "AUTH_ACTION_INVALID_OR_EXPIRED", retryable: false },
  AUTH_FAILED: { messageCode: "AUTHENTICATION_FAILED", retryable: false },
  CALCULATION_UNAVAILABLE: { messageCode: "CALCULATION_TEMPORARILY_UNAVAILABLE", retryable: true },
  CAPABILITY_UNAVAILABLE: { messageCode: "CAPABILITY_TEMPORARILY_UNAVAILABLE", retryable: true },
  EMAIL_NOT_VERIFIED: { messageCode: "EMAIL_VERIFICATION_REQUIRED", retryable: false },
  EXPORT_NOT_READY: { messageCode: "EXPORT_NOT_READY", retryable: false },
  FORBIDDEN: { messageCode: "OPERATION_NOT_PERMITTED", retryable: false },
  IDEMPOTENCY_CONFLICT: { messageCode: "IDEMPOTENCY_KEY_CONTENT_CONFLICT", retryable: false },
  LABEL_CONFLICT: { messageCode: "LABEL_NAME_CONFLICT", retryable: false },
  NOT_FOUND: { messageCode: "RESOURCE_NOT_FOUND", retryable: false },
  OPERATION_IN_PROGRESS: { messageCode: "OPERATION_ALREADY_IN_PROGRESS", retryable: true },
  PRIVACY_BOUNDARY_BLOCKED: {
    messageCode: "REMOVE_PROHIBITED_SENSITIVE_CONTENT",
    retryable: false,
  },
  RATE_LIMITED: { messageCode: "RATE_LIMIT_RETRY_LATER", retryable: true },
  REAUTH_REQUIRED: { messageCode: "RECENT_AUTHENTICATION_REQUIRED", retryable: false },
  RESULTS_CHANGED: { messageCode: "RESULTS_CHANGED_REFRESH_REQUIRED", retryable: false },
  REVISION_CONFLICT: { messageCode: "REVISION_CHANGED_RELOAD_REQUIRED", retryable: false },
  STATE_CONFLICT: { messageCode: "LIFECYCLE_STATE_CONFLICT", retryable: false },
  UNAUTHENTICATED: { messageCode: "AUTHENTICATION_REQUIRED", retryable: false },
  VALIDATION_FAILED: { messageCode: "VALIDATION_FAILED_REVIEW_FIELDS", retryable: false },
} as const satisfies Record<ProductErrorCode, { messageCode: string; retryable: boolean }>;

type ProductMessageCode = (typeof errorPolicy)[ProductErrorCode]["messageCode"];

class ProductErrorConstructionError extends Error {
  constructor() {
    super("Product error construction rejected unsafe metadata.");
    this.name = "ProductErrorConstructionError";
  }
}

class ProductError extends Error {
  readonly code: ProductErrorCode;
  readonly currentResultSetVersion: string | null;
  readonly currentRevision: string | null;
  readonly fieldErrors: readonly ProductFieldError[];
  readonly messageCode: ProductMessageCode;
  readonly restartRequired: boolean | null;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(code: ProductErrorCode, options: ProductErrorOptions = {}) {
    const policy = errorPolicy[code];
    super(policy.messageCode);
    this.name = "ProductError";
    this.code = code;
    this.messageCode = policy.messageCode;
    this.retryable = policy.retryable;
    this.currentRevision = validateRevision(options.currentRevision);
    this.currentResultSetVersion = validateRevision(options.currentResultSetVersion);
    this.retryAfterSeconds = validateRetryAfter(options.retryAfterSeconds);
    this.fieldErrors = Object.freeze(
      (options.fieldErrors ?? []).map((fieldError) => {
        if (!productFieldSet.has(fieldError.field) || !fieldErrorReasonSet.has(fieldError.reason)) {
          throw new ProductErrorConstructionError();
        }
        return Object.freeze({ field: fieldError.field, reason: fieldError.reason });
      }),
    );
    this.restartRequired = code === "RESULTS_CHANGED" ? true : null;

    if (code === "RESULTS_CHANGED" && this.currentResultSetVersion === null) {
      throw new ProductErrorConstructionError();
    }
    if (code === "RATE_LIMITED" && this.retryAfterSeconds === null) {
      throw new ProductErrorConstructionError();
    }
    if (code !== "VALIDATION_FAILED" && this.fieldErrors.length > 0) {
      throw new ProductErrorConstructionError();
    }
    if (code !== "REVISION_CONFLICT" && this.currentRevision !== null) {
      throw new ProductErrorConstructionError();
    }

    Object.freeze(this);
  }
}

function validateRevision(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^[1-9][0-9]*$/u.test(value)) throw new ProductErrorConstructionError();
  return value;
}

function validateRetryAfter(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new ProductErrorConstructionError();
  return value;
}

function createProductError(code: ProductErrorCode, options?: ProductErrorOptions): ProductError {
  return new ProductError(code, options);
}

export {
  ProductError,
  ProductErrorConstructionError,
  createProductError,
  fieldErrorReasons,
  productErrorCodes,
  productFields,
  type FieldErrorReason,
  type ProductErrorCode,
  type ProductErrorOptions,
  type ProductField,
  type ProductFieldError,
  type ProductMessageCode,
};
