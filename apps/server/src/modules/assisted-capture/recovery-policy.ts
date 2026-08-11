import type { ProviderFailureState } from "./provider-ports.js";

export type AssistedRecoveryState =
  "correction_required" | "failed_recoverable" | "manual_entry_available";

export interface AssistedRecoveryDecision {
  readonly authoritative: false;
  readonly audioRetentionExtended: false;
  readonly confirmedMemoMutationAllowed: false;
  readonly errorCode:
    "AI_INCOMPLETE_OUTPUT" | "AI_UNAVAILABLE" | "STT_INCOMPLETE" | "STT_UNAVAILABLE";
  readonly retainDraftUntilDeclaredExpiry: boolean;
  readonly retainTranscriptUntilDeclaredExpiry: boolean;
  readonly state: AssistedRecoveryState;
}

export function assistedRecoveryPolicy(input: {
  readonly failure: ProviderFailureState;
  readonly stage: "extraction" | "stt";
  readonly transcriptAvailable: boolean;
}): AssistedRecoveryDecision {
  const incomplete = input.failure === "incomplete" || input.failure === "partial";
  if (input.stage === "stt") {
    return Object.freeze({
      authoritative: false,
      audioRetentionExtended: false,
      confirmedMemoMutationAllowed: false,
      errorCode: incomplete ? "STT_INCOMPLETE" : "STT_UNAVAILABLE",
      retainDraftUntilDeclaredExpiry: true,
      retainTranscriptUntilDeclaredExpiry: incomplete && input.transcriptAvailable,
      state: incomplete ? "correction_required" : "manual_entry_available",
    });
  }
  return Object.freeze({
    authoritative: false,
    audioRetentionExtended: false,
    confirmedMemoMutationAllowed: false,
    errorCode: incomplete ? "AI_INCOMPLETE_OUTPUT" : "AI_UNAVAILABLE",
    retainDraftUntilDeclaredExpiry: true,
    retainTranscriptUntilDeclaredExpiry: input.transcriptAvailable,
    state: incomplete ? "correction_required" : "failed_recoverable",
  });
}
