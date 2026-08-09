import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SIGNED_64 = 9_223_372_036_854_775_807n;
const REVISION_PATTERN = /^[1-9][0-9]*$/u;
const HMAC_PATTERN = /^[a-f0-9]{64}$/u;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const RESPONSE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class ReliabilityPrimitiveError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid reliability primitive: ${reason}`);
    this.name = "ReliabilityPrimitiveError";
  }
}

function assertHmacKey(hmacKey: Uint8Array): void {
  if (hmacKey.byteLength < 32) throw new ReliabilityPrimitiveError("hmac_key_too_short");
}

function assertDomainLabel(value: string, field: string): void {
  if (!DOMAIN_LABEL_PATTERN.test(value)) {
    throw new ReliabilityPrimitiveError(`${field}_invalid`);
  }
}

export function parseRevision(value: string): bigint {
  if (!REVISION_PATTERN.test(value)) throw new ReliabilityPrimitiveError("revision_format");
  const revision = BigInt(value);
  if (revision > MAX_SIGNED_64) throw new ReliabilityPrimitiveError("revision_overflow");
  return revision;
}

export interface RevisionAdvanced {
  readonly currentRevision: string;
  readonly nextRevision: string;
  readonly outcome: "advanced";
}

export interface RevisionConflict {
  readonly currentRevision: string;
  readonly outcome: "conflict";
}

export type RevisionComparison = RevisionAdvanced | RevisionConflict;

export function compareAndAdvanceRevision(
  expectedRevision: string,
  currentRevision: string,
): RevisionComparison {
  const expected = parseRevision(expectedRevision);
  const current = parseRevision(currentRevision);
  if (expected !== current) return { currentRevision, outcome: "conflict" };
  if (current === MAX_SIGNED_64) throw new ReliabilityPrimitiveError("revision_overflow");
  return {
    currentRevision,
    nextRevision: (current + 1n).toString(),
    outcome: "advanced",
  };
}

function canonicalJson(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new ReliabilityPrimitiveError("unsafe_json_number");
    return Object.is(value, -0) ? "0" : value.toString();
  }
  if (typeof value !== "object") throw new ReliabilityPrimitiveError("non_json_value");
  if (ancestors.has(value)) throw new ReliabilityPrimitiveError("cyclic_payload");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new ReliabilityPrimitiveError("sparse_array");
      }
      return `[${value.map((entry) => canonicalJson(entry, ancestors)).join(",")}]`;
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new ReliabilityPrimitiveError("non_plain_object");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new ReliabilityPrimitiveError("symbol_key");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(value).sort();
    if (keys.length !== ownKeys.length) throw new ReliabilityPrimitiveError("hidden_property");
    return `{${keys
      .map((key) => {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined
        ) {
          throw new ReliabilityPrimitiveError("accessor_property");
        }
        return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
      })
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export interface CanonicalRequestHmacInput {
  readonly hmacKey: Uint8Array;
  readonly operation: string;
  readonly payload: unknown;
  readonly schemaVersion: string;
}

export function canonicalRequestHmac(input: CanonicalRequestHmacInput): string {
  assertHmacKey(input.hmacKey);
  assertDomainLabel(input.operation, "operation");
  assertDomainLabel(input.schemaVersion, "schema_version");
  const canonicalPayload = canonicalJson(input.payload, new WeakSet<object>());
  return createHmac("sha256", input.hmacKey)
    .update("cashmemo:idempotency:v1\0", "utf8")
    .update(input.operation, "utf8")
    .update("\0", "utf8")
    .update(input.schemaVersion, "utf8")
    .update("\0", "utf8")
    .update(canonicalPayload, "utf8")
    .digest("hex");
}

export function requestHmacEqual(first: string, second: string): boolean {
  if (!HMAC_PATTERN.test(first) || !HMAC_PATTERN.test(second)) return false;
  return timingSafeEqual(Buffer.from(first, "hex"), Buffer.from(second, "hex"));
}

export type IdempotencyState = "in_progress" | "succeeded" | "failed_retryable" | "failed_final";

export interface IdempotencyResultReference {
  readonly id: string;
  readonly revision: string;
  readonly type: string;
}

export interface IdempotencyRecordSnapshot {
  readonly requestHmac: string;
  readonly responseCode?: string;
  readonly result?: IdempotencyResultReference;
  readonly state: IdempotencyState;
}

export type IdempotencyRetryDecision =
  | { readonly outcome: "begin" }
  | { readonly outcome: "idempotency_conflict" }
  | { readonly outcome: "operation_in_progress" }
  | { readonly outcome: "retry" }
  | { readonly outcome: "replay_success"; readonly result: IdempotencyResultReference }
  | { readonly outcome: "replay_final"; readonly responseCode: string };

export function classifyIdempotentRetry(
  existing: IdempotencyRecordSnapshot | null,
  incomingRequestHmac: string,
): IdempotencyRetryDecision {
  if (!HMAC_PATTERN.test(incomingRequestHmac)) {
    throw new ReliabilityPrimitiveError("request_hmac_invalid");
  }
  if (existing === null) return { outcome: "begin" };
  if (!requestHmacEqual(existing.requestHmac, incomingRequestHmac)) {
    return { outcome: "idempotency_conflict" };
  }
  if (existing.state === "in_progress") return { outcome: "operation_in_progress" };
  if (existing.state === "failed_retryable") return { outcome: "retry" };
  if (existing.state === "succeeded") {
    if (existing.result === undefined) throw new ReliabilityPrimitiveError("missing_result");
    parseRevision(existing.result.revision);
    return { outcome: "replay_success", result: existing.result };
  }
  if (existing.responseCode === undefined) {
    throw new ReliabilityPrimitiveError("missing_response_code");
  }
  if (!RESPONSE_CODE_PATTERN.test(existing.responseCode)) {
    throw new ReliabilityPrimitiveError("response_code_invalid");
  }
  return { outcome: "replay_final", responseCode: existing.responseCode };
}

export type BackgroundJobType =
  | "draft_expire"
  | "memo_purge"
  | "account_purge"
  | "export_build"
  | "export_delete"
  | "provider_delete"
  | "reconcile";
export type JobReferenceType =
  "draft" | "money_memo" | "account" | "export_job" | "provider_deletion";

export interface DeterministicJobKeyInput {
  readonly hmacKey: Uint8Array;
  readonly jobType: BackgroundJobType;
  readonly referenceId: string;
  readonly referenceType: JobReferenceType;
  readonly scheduleIdentity: string;
}

export function deterministicJobKey(input: DeterministicJobKeyInput): string {
  assertHmacKey(input.hmacKey);
  if (!UUID_PATTERN.test(input.referenceId)) {
    throw new ReliabilityPrimitiveError("reference_id_invalid");
  }
  if (input.scheduleIdentity.length < 1 || input.scheduleIdentity.length > 128) {
    throw new ReliabilityPrimitiveError("schedule_identity_invalid");
  }
  const digest = createHmac("sha256", input.hmacKey)
    .update("cashmemo:job:v1\0", "utf8")
    .update(input.jobType, "utf8")
    .update("\0", "utf8")
    .update(input.referenceType, "utf8")
    .update("\0", "utf8")
    .update(input.referenceId, "utf8")
    .update("\0", "utf8")
    .update(input.scheduleIdentity, "utf8")
    .digest("hex");
  return `job:v1:${digest}`;
}
