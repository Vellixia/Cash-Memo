export const providerFailureStates = [
  "timeout",
  "rate_limit",
  "refusal",
  "unavailable",
  "invalid_schema",
  "partial",
  "incomplete",
] as const;

export type ProviderFailureState = (typeof providerFailureStates)[number];
export type SupportedAudioMediaType =
  "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/wav" | "audio/webm";

export interface SttRequest {
  readonly attempt: number;
  readonly audio: Uint8Array;
  readonly consent: string;
  readonly currentRecordingOnly: boolean;
  readonly deadlineMs: number;
  readonly detectorLimitationDisclosed: boolean;
  readonly mediaType: SupportedAudioMediaType;
}

export type SttResult =
  | { readonly completeness: "complete"; readonly state: "success"; readonly transcript: string }
  | {
      readonly completeness: "incomplete";
      readonly state: "incomplete";
      readonly transcript: string;
    }
  | { readonly retryAfterSeconds: number | null; readonly state: "rate_limit" }
  | { readonly state: "refusal" | "timeout" | "unavailable" };

export interface ExtractedDraftFields {
  readonly amount?: string | null;
  readonly categoryId?: string | null;
  readonly currency?: string | null;
  readonly direction?: "expense" | "income" | null;
  readonly moneySpaceId?: string | null;
  readonly note?: string | null;
  readonly occurredLocal?: string | null;
  readonly occurredOffsetMinutes?: number | null;
  readonly occurredTimezone?: string | null;
  readonly planningStatus?: "planned" | "unplanned" | null;
  readonly purpose?: "mixed" | "personal" | "work" | null;
}

export interface FieldAssessment {
  readonly field: keyof ExtractedDraftFields;
  readonly reasonCode:
    | "AMBIGUOUS_AMOUNT"
    | "AMBIGUOUS_DATE"
    | "AMBIGUOUS_DIRECTION"
    | "CONTRADICTORY_TEXT"
    | "PROVIDER_OMISSION"
    | "UNKNOWN_LABEL"
    | "UNSUPPORTED_CURRENCY"
    | null;
  readonly source: "ai" | "parser" | "stt" | "user";
  readonly status: "contradictory" | "inferred" | "invalid" | "missing" | "provided" | "uncertain";
}

export interface ExtractionRequest {
  readonly attempt: number;
  readonly captureStartedAt: string;
  readonly captureTimezone: string;
  readonly consent: string;
  readonly deadlineMs: number;
  readonly text: string;
}

export type ExtractionResult =
  | {
      readonly assessments: readonly FieldAssessment[];
      readonly fields: ExtractedDraftFields;
      readonly state: "ambiguous" | "success";
    }
  | { readonly state: "invalid_schema" | "refusal" | "timeout" | "unavailable" }
  | { readonly retryAfterSeconds: number | null; readonly state: "rate_limit" };

export interface SttPort {
  transcribe(request: Readonly<SttRequest>): Promise<SttResult>;
}

export interface ExtractionPort {
  extract(request: Readonly<ExtractionRequest>): Promise<ExtractionResult>;
}

function assertDeadlineAndAttempt(deadlineMs: number, attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2) {
    throw new Error("PROVIDER_REQUEST_INVALID");
  }
  if (!Number.isInteger(deadlineMs) || deadlineMs < 250 || deadlineMs > 60_000) {
    throw new Error("PROVIDER_REQUEST_INVALID");
  }
}

export function assertSttRequest(request: Readonly<SttRequest>): void {
  if (request.consent !== "SEND_THIS_RECORDING_FOR_TRANSCRIPTION") {
    throw new Error("PROVIDER_CONSENT_REQUIRED");
  }
  assertDeadlineAndAttempt(request.deadlineMs, request.attempt);
  if (
    !request.currentRecordingOnly ||
    !request.detectorLimitationDisclosed ||
    request.audio.byteLength === 0
  ) {
    throw new Error("PROVIDER_REQUEST_INVALID");
  }
}

export function assertExtractionRequest(request: Readonly<ExtractionRequest>): void {
  if (
    request.consent !== "SEND_THIS_TEXT_FOR_AI_EXTRACTION" &&
    request.consent !== "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION"
  ) {
    throw new Error("PROVIDER_CONSENT_REQUIRED");
  }
  assertDeadlineAndAttempt(request.deadlineMs, request.attempt);
  if (request.text.length === 0 || request.text.length > 4_000) {
    throw new Error("PROVIDER_REQUEST_INVALID");
  }
}
