import { createHash } from "node:crypto";

import type { DiagnosticEvent } from "@cashmemo/domain";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;

export class FakeProviderContractError extends Error {
  constructor(readonly reason: string) {
    super(`Fake provider contract violation: ${reason}`);
    this.name = "FakeProviderContractError";
  }
}

export interface EphemeralAudioSource {
  chunks(): AsyncIterable<Uint8Array>;
}

export type SttMediaType = "webm_opus" | "ogg_opus" | "mp4_aac" | "wav_pcm" | "mp3";

export interface TranscriptionRequestV1 {
  readonly audio: EphemeralAudioSource;
  readonly byteLength: number;
  readonly consentVersion: string;
  readonly correlationId: string;
  readonly deadlineAt: string;
  readonly languageHint: string | null;
  readonly measuredDurationMs: number;
  readonly mediaType: SttMediaType;
  readonly providerDecisionVersion: string;
}

export type TranscriptionResultV1 =
  | {
      readonly completeness: "complete" | "incomplete";
      readonly kind: "transcript";
      readonly language: string | null;
      readonly text: string;
      readonly truncation: "none" | "provider_limit" | "deadline";
    }
  | {
      readonly code:
        | "unavailable"
        | "timeout"
        | "rate_limited"
        | "unsupported_audio"
        | "invalid_output"
        | "refused";
      readonly kind: "failure";
      readonly retryAfterSeconds: number | null;
      readonly retryable: boolean;
    };

export interface SttPortLike {
  transcribe(request: TranscriptionRequestV1): Promise<TranscriptionResultV1>;
}

export interface SafeSttCall {
  readonly byteLength: number;
  readonly correlationId: string;
  readonly measuredDurationMs: number;
  readonly mediaType: SttMediaType;
  readonly providerDecisionVersion: string;
}

export type MoneyMemoDraftField =
  | "direction"
  | "amount"
  | "currency"
  | "occurredLocal"
  | "occurredTimezone"
  | "occurredOffsetMinutes"
  | "categoryId"
  | "moneySpaceId"
  | "purpose"
  | "planningStatus"
  | "note";

export interface ExtractionAssessmentV1 {
  readonly field: MoneyMemoDraftField;
  readonly reasonCode:
    | "AMBIGUOUS_AMOUNT"
    | "AMBIGUOUS_DATE"
    | "AMBIGUOUS_DIRECTION"
    | "UNSUPPORTED_CURRENCY"
    | "UNKNOWN_LABEL"
    | "CONTRADICTORY_TEXT"
    | "PROVIDER_OMISSION"
    | null;
  readonly status: "provided" | "inferred" | "uncertain" | "missing" | "contradictory";
}

export interface ExtractionCandidateV1 {
  readonly assessments: readonly ExtractionAssessmentV1[];
  readonly fields: {
    readonly amount: string | null;
    readonly categoryId: string | null;
    readonly currency: string | null;
    readonly direction: "income" | "expense" | null;
    readonly moneySpaceId: string | null;
    readonly note: string | null;
    readonly occurredLocal: string | null;
    readonly occurredOffsetMinutes: number | null;
    readonly occurredTimezone: string | null;
    readonly planningStatus: "planned" | "unplanned" | null;
    readonly purpose: "personal" | "work" | "mixed" | null;
  };
  readonly schemaVersion: "money-memo-draft-1";
}

export interface ExtractionLabelV1 {
  readonly id: string;
  readonly name: string;
}

export interface ExtractionCategoryV1 extends ExtractionLabelV1 {
  readonly kind: "income" | "expense";
}

export interface ExtractionRequestV1 {
  readonly allowedCategories: readonly ExtractionCategoryV1[];
  readonly allowedMoneySpaces: readonly ExtractionLabelV1[];
  readonly captureStartedAt: string;
  readonly captureText: string;
  readonly captureTimezone: string;
  readonly consentVersion: string;
  readonly correlationId: string;
  readonly deadlineAt: string;
  readonly defaultCurrency: string;
  readonly locale: string;
  readonly providerDecisionVersion: string;
  readonly schemaVersion: "money-memo-draft-1";
}

export type ExtractionResultV1 =
  | { readonly candidate: ExtractionCandidateV1; readonly kind: "candidate" }
  | { readonly kind: "correction_required"; readonly safeReasonCodes: readonly string[] }
  | {
      readonly code: "unavailable" | "timeout" | "rate_limited" | "invalid_schema" | "refused";
      readonly kind: "failure";
      readonly retryAfterSeconds: number | null;
      readonly retryable: boolean;
    };

export interface ExtractionPortLike {
  extract(request: ExtractionRequestV1): Promise<ExtractionResultV1>;
}

export interface TransactionalEmailV1 {
  readonly destination: string;
  readonly expiresAt: string;
  readonly kind: "verify_email" | "reset_password";
  readonly locale: string;
  readonly oneTimeUrl: string;
  readonly providerDecisionVersion: string;
}

export type EmailResultV1 =
  | { readonly kind: "accepted"; readonly providerReferenceHmac: string }
  | {
      readonly code: "unavailable" | "rate_limited" | "rejected";
      readonly kind: "failure";
      readonly retryable: boolean;
    };

export interface EmailPortLike {
  sendTransactional(request: TransactionalEmailV1): Promise<EmailResultV1>;
}

interface ScriptedFakeOptions<TResult> {
  readonly now?: () => Date;
  readonly results: readonly TResult[];
}

class ScriptedResults<TResult> {
  private readonly remaining: TResult[];

  constructor(results: readonly TResult[]) {
    this.remaining = [...structuredClone(results)];
  }

  take(): TResult {
    const result = this.remaining.shift();
    if (result === undefined) throw new FakeProviderContractError("script_exhausted");
    return structuredClone(result);
  }
}

function validateInstant(value: string, name: string): Date {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf()) || instant.toISOString() !== value) {
    throw new FakeProviderContractError(`${name}_invalid`);
  }
  return instant;
}

function validateCommonRequest(
  request: {
    readonly correlationId: string;
    readonly deadlineAt: string;
    readonly providerDecisionVersion: string;
  },
  now: () => Date,
): void {
  if (!UUID_PATTERN.test(request.correlationId)) {
    throw new FakeProviderContractError("correlation_id_invalid");
  }
  if (!SAFE_ID_PATTERN.test(request.providerDecisionVersion)) {
    throw new FakeProviderContractError("provider_decision_version_invalid");
  }
  if (validateInstant(request.deadlineAt, "deadline").valueOf() <= now().valueOf()) {
    throw new FakeProviderContractError("deadline_elapsed");
  }
}

export class FakeSttPort implements SttPortLike {
  readonly calls: SafeSttCall[] = [];
  private readonly now: () => Date;
  private readonly results: ScriptedResults<TranscriptionResultV1>;

  constructor(options: ScriptedFakeOptions<TranscriptionResultV1>) {
    this.now = options.now ?? (() => new Date());
    this.results = new ScriptedResults(options.results);
  }

  async transcribe(request: TranscriptionRequestV1): Promise<TranscriptionResultV1> {
    validateCommonRequest(request, this.now);
    if (
      !Number.isSafeInteger(request.byteLength) ||
      request.byteLength < 1 ||
      request.byteLength > 10_485_760
    ) {
      throw new FakeProviderContractError("byte_length_invalid");
    }
    if (
      !Number.isSafeInteger(request.measuredDurationMs) ||
      request.measuredDurationMs < 1 ||
      request.measuredDurationMs > 60_000
    ) {
      throw new FakeProviderContractError("duration_invalid");
    }
    let consumedBytes = 0;
    for await (const chunk of request.audio.chunks()) consumedBytes += chunk.byteLength;
    if (consumedBytes !== request.byteLength) {
      throw new FakeProviderContractError("audio_length_mismatch");
    }
    this.calls.push(
      Object.freeze({
        byteLength: request.byteLength,
        correlationId: request.correlationId,
        measuredDurationMs: request.measuredDurationMs,
        mediaType: request.mediaType,
        providerDecisionVersion: request.providerDecisionVersion,
      }),
    );
    return this.results.take();
  }
}

export class FakeExtractionPort implements ExtractionPortLike {
  readonly calls: ExtractionRequestV1[] = [];
  private readonly now: () => Date;
  private readonly results: ScriptedResults<ExtractionResultV1>;

  constructor(options: ScriptedFakeOptions<ExtractionResultV1>) {
    this.now = options.now ?? (() => new Date());
    this.results = new ScriptedResults(options.results);
  }

  async extract(request: ExtractionRequestV1): Promise<ExtractionResultV1> {
    await Promise.resolve();
    validateCommonRequest(request, this.now);
    const schemaVersion: unknown = request.schemaVersion;
    if (schemaVersion !== "money-memo-draft-1") {
      throw new FakeProviderContractError("schema_version_invalid");
    }
    if (request.captureText.length < 1 || request.captureText.length > 4_000) {
      throw new FakeProviderContractError("capture_text_length_invalid");
    }
    this.calls.push(structuredClone(request));
    return this.results.take();
  }
}

export class FakeEmailPort implements EmailPortLike {
  readonly calls: TransactionalEmailV1[] = [];
  private readonly results: ScriptedResults<EmailResultV1>;

  constructor(results: readonly EmailResultV1[]) {
    this.results = new ScriptedResults(results);
  }

  async sendTransactional(request: TransactionalEmailV1): Promise<EmailResultV1> {
    await Promise.resolve();
    validateInstant(request.expiresAt, "expires_at");
    if (
      !/^https:\/\/[^/?#]+\/(?:verify-email|reset-password)\/[A-Za-z0-9_-]+$/u.test(
        request.oneTimeUrl,
      )
    ) {
      throw new FakeProviderContractError("one_time_url_invalid");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(request.destination)) {
      throw new FakeProviderContractError("destination_invalid");
    }
    this.calls.push(structuredClone(request));
    return this.results.take();
  }
}

export type ObjectClass =
  "export_package" | "acceptance_evidence" | "deletion_suppression" | "deletion_evidence";

export interface ObjectStorePutRequest {
  readonly accountScopeHmac: string;
  readonly body: Uint8Array;
  readonly expectedSha256: string;
  readonly kmsKeyPolicy: string;
  readonly maximumExpiryAt: string | null;
  readonly objectClass: ObjectClass;
}

export interface ObjectStorePutResult {
  readonly kind: "stored";
  readonly objectReference: string;
  readonly sha256: string;
}

export interface ObjectStorePortLike {
  delete(objectReference: string): Promise<{ readonly deleted: boolean }>;
  get(objectReference: string): Promise<Uint8Array>;
  put(request: ObjectStorePutRequest): Promise<ObjectStorePutResult>;
}

export interface SafeObjectStoreCall {
  readonly byteLength: number;
  readonly objectClass: ObjectClass;
  readonly objectReference: string;
  readonly sha256: string;
}

export class FakeObjectStorePort implements ObjectStorePortLike {
  readonly calls: SafeObjectStoreCall[] = [];
  private nextReference = 1;
  private readonly objects = new Map<string, Uint8Array>();

  async put(request: ObjectStorePutRequest): Promise<ObjectStorePutResult> {
    await Promise.resolve();
    if (
      !SHA256_PATTERN.test(request.accountScopeHmac) ||
      !SHA256_PATTERN.test(request.expectedSha256)
    ) {
      throw new FakeProviderContractError("hash_invalid");
    }
    if (!SAFE_ID_PATTERN.test(request.kmsKeyPolicy)) {
      throw new FakeProviderContractError("kms_policy_invalid");
    }
    if (request.objectClass === "deletion_suppression") {
      if (request.maximumExpiryAt !== null) {
        throw new FakeProviderContractError("suppression_ttl_forbidden");
      }
    } else if (request.maximumExpiryAt === null) {
      throw new FakeProviderContractError("maximum_expiry_required");
    } else {
      validateInstant(request.maximumExpiryAt, "maximum_expiry");
    }
    const actualSha256 = createHash("sha256").update(request.body).digest("hex");
    if (actualSha256 !== request.expectedSha256) {
      throw new FakeProviderContractError("checksum_mismatch");
    }
    const objectReference = `fake-object-${this.nextReference.toString().padStart(6, "0")}`;
    this.nextReference += 1;
    this.objects.set(objectReference, request.body.slice());
    this.calls.push(
      Object.freeze({
        byteLength: request.body.byteLength,
        objectClass: request.objectClass,
        objectReference,
        sha256: actualSha256,
      }),
    );
    return { kind: "stored", objectReference, sha256: actualSha256 };
  }

  async get(objectReference: string): Promise<Uint8Array> {
    await Promise.resolve();
    const body = this.objects.get(objectReference);
    if (body === undefined) throw new FakeProviderContractError("object_not_found");
    return body.slice();
  }

  async delete(objectReference: string): Promise<{ readonly deleted: boolean }> {
    await Promise.resolve();
    return { deleted: this.objects.delete(objectReference) };
  }
}

export interface TelemetryPortLike {
  emit(event: DiagnosticEvent): void;
}

export class FakeTelemetryPort implements TelemetryPortLike {
  readonly events: DiagnosticEvent[] = [];

  emit(event: DiagnosticEvent): void {
    this.events.push(Object.freeze(structuredClone(event)));
  }
}
