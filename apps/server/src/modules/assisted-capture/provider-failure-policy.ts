import type { ProviderFailureState } from "./provider-ports.js";

export type ProviderCapabilityCode = "AI" | "STT";

export interface ProviderFailureView {
  readonly capability: ProviderCapabilityCode;
  readonly code:
    | "AI_INCOMPLETE_OUTPUT"
    | "AI_INVALID_OUTPUT"
    | "AI_RATE_LIMITED"
    | "AI_REFUSED"
    | "AI_TIMEOUT"
    | "AI_UNAVAILABLE"
    | "STT_INCOMPLETE"
    | "STT_INVALID_OUTPUT"
    | "STT_RATE_LIMITED"
    | "STT_REFUSED"
    | "STT_TIMEOUT"
    | "STT_UNAVAILABLE";
  readonly retryable: boolean;
}

export function providerFailure(
  capability: ProviderCapabilityCode,
  state: ProviderFailureState,
  attempt: number,
): ProviderFailureView {
  const suffix =
    state === "rate_limit"
      ? "RATE_LIMITED"
      : state === "refusal"
        ? "REFUSED"
        : state === "timeout"
          ? "TIMEOUT"
          : state === "invalid_schema"
            ? "INVALID_OUTPUT"
            : state === "partial" || state === "incomplete"
              ? "INCOMPLETE_OUTPUT"
              : "UNAVAILABLE";
  const normalizedSuffix =
    capability === "STT" && suffix === "INCOMPLETE_OUTPUT" ? "INCOMPLETE" : suffix;
  return Object.freeze({
    capability,
    code: `${capability}_${normalizedSuffix}` as ProviderFailureView["code"],
    retryable:
      attempt < 2 && (state === "timeout" || state === "rate_limit" || state === "unavailable"),
  });
}
