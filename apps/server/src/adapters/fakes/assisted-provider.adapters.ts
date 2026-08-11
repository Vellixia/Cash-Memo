import {
  assertExtractionRequest,
  assertSttRequest,
  type ExtractedDraftFields,
  type ExtractionPort,
  type ExtractionRequest,
  type ExtractionResult,
  type FieldAssessment,
  type SttPort,
  type SttRequest,
  type SttResult,
} from "../../modules/assisted-capture/provider-ports.js";

type SttFakeMode = "failure" | "incomplete" | "rate_limit" | "refusal" | "success" | "timeout";
type ExtractionFakeMode =
  "ambiguous" | "failure" | "invalid_schema" | "rate_limit" | "refusal" | "success" | "timeout";

function scenario(text: string): string | null {
  const match = /\[scenario:([a-z_-]+)\]/u.exec(text);
  return match?.[1] ?? null;
}

export interface ContentFreeProviderCall {
  readonly attempt: number;
  readonly inputLengthClass: "large" | "medium" | "small";
  readonly operation: "extraction" | "stt";
}

function lengthClass(length: number): ContentFreeProviderCall["inputLengthClass"] {
  return length < 1_024 ? "small" : length < 1_048_576 ? "medium" : "large";
}

export class DeterministicSttAdapter implements SttPort {
  readonly calls: ContentFreeProviderCall[] = [];
  private readonly mode: SttFakeMode;
  private readonly transcript: string;

  constructor(options: { readonly mode: SttFakeMode; readonly transcript?: string }) {
    this.mode = options.mode;
    this.transcript = options.transcript ?? "synthetic complete transcript";
  }

  transcribe(request: Readonly<SttRequest>): Promise<SttResult> {
    assertSttRequest(request);
    this.calls.push({
      attempt: request.attempt,
      inputLengthClass: lengthClass(request.audio.byteLength),
      operation: "stt",
    });
    switch (this.mode) {
      case "success":
        return Promise.resolve({
          completeness: "complete",
          state: "success",
          transcript: this.transcript,
        });
      case "incomplete":
        return Promise.resolve({
          completeness: "incomplete",
          state: "incomplete",
          transcript: this.transcript,
        });
      case "rate_limit":
        return Promise.resolve({ retryAfterSeconds: 1, state: "rate_limit" });
      case "refusal":
        return Promise.resolve({ state: "refusal" });
      case "timeout":
        return Promise.resolve({ state: "timeout" });
      case "failure":
        return Promise.resolve({ state: "unavailable" });
    }
  }
}

export class DeterministicExtractionAdapter implements ExtractionPort {
  readonly calls: ContentFreeProviderCall[] = [];
  private readonly assessments: readonly FieldAssessment[];
  private readonly fields: ExtractedDraftFields;
  private readonly mode: ExtractionFakeMode;

  constructor(options: {
    readonly assessments?: readonly FieldAssessment[];
    readonly fields?: ExtractedDraftFields;
    readonly mode: ExtractionFakeMode;
  }) {
    this.mode = options.mode;
    this.fields = options.fields ?? { amount: "12.50", currency: "USD", direction: "expense" };
    this.assessments = options.assessments ?? [];
  }

  extract(request: Readonly<ExtractionRequest>): Promise<ExtractionResult> {
    assertExtractionRequest(request);
    this.calls.push({
      attempt: request.attempt,
      inputLengthClass: lengthClass(request.text.length),
      operation: "extraction",
    });
    switch (this.mode) {
      case "success":
        return Promise.resolve({
          assessments: this.assessments,
          fields: this.fields,
          state: "success",
        });
      case "ambiguous":
        return Promise.resolve({
          assessments: this.assessments,
          fields: this.fields,
          state: "ambiguous",
        });
      case "invalid_schema":
        return Promise.resolve({ state: "invalid_schema" });
      case "rate_limit":
        return Promise.resolve({ retryAfterSeconds: 1, state: "rate_limit" });
      case "refusal":
        return Promise.resolve({ state: "refusal" });
      case "timeout":
        return Promise.resolve({ state: "timeout" });
      case "failure":
        return Promise.resolve({ state: "unavailable" });
    }
  }
}

/** Local/acceptance-only adapter. Scenario markers are synthetic contract-fixture controls. */
export class ContractScenarioExtractionAdapter implements ExtractionPort {
  readonly calls: ContentFreeProviderCall[] = [];

  extract(request: Readonly<ExtractionRequest>): Promise<ExtractionResult> {
    assertExtractionRequest(request);
    this.calls.push({
      attempt: request.attempt,
      inputLengthClass: lengthClass(request.text.length),
      operation: "extraction",
    });
    switch (scenario(request.text)) {
      case "ambiguous":
        return Promise.resolve({
          assessments: [
            { field: "amount", reasonCode: "AMBIGUOUS_AMOUNT", source: "ai", status: "uncertain" },
          ],
          fields: { amount: null, currency: "USD", direction: "expense" },
          state: "ambiguous",
        });
      case "timeout":
        return Promise.resolve({ state: "timeout" });
      case "rate_limit":
        return Promise.resolve({ retryAfterSeconds: 1, state: "rate_limit" });
      case "refusal":
        return Promise.resolve({ state: "refusal" });
      case "unavailable":
        return Promise.resolve({ state: "unavailable" });
      case "invalid_schema":
        return Promise.resolve({ state: "invalid_schema" });
      case null:
        return Promise.resolve({
          assessments: [],
          fields: { amount: "12.50", currency: "USD", direction: "expense" },
          state: "success",
        });
      default:
        return Promise.resolve({ state: "unavailable" });
    }
  }
}

/** Local/acceptance-only STT. Last byte selects synthetic failure without retaining audio. */
export class ContractScenarioSttAdapter implements SttPort {
  readonly calls: ContentFreeProviderCall[] = [];

  transcribe(request: Readonly<SttRequest>): Promise<SttResult> {
    assertSttRequest(request);
    this.calls.push({
      attempt: request.attempt,
      inputLengthClass: lengthClass(request.audio.byteLength),
      operation: "stt",
    });
    const marker = request.audio.at(-1);
    if (marker === 1) return Promise.resolve({ state: "timeout" });
    if (marker === 2) return Promise.resolve({ state: "refusal" });
    if (marker === 3) {
      return Promise.resolve({
        completeness: "incomplete",
        state: "incomplete",
        transcript: "synthetic incomplete transcript",
      });
    }
    return Promise.resolve({
      completeness: "complete",
      state: "success",
      transcript: "synthetic complete transcript",
    });
  }
}
