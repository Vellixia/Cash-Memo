export const privacyRuleFamilies = [
  "PAN_LUHN_V1",
  "IBAN_MOD97_V1",
  "CARD_SECRET_LABEL_V1",
  "ACCESS_SECRET_LABEL_V1",
  "BANK_ACCOUNT_LABEL_V1",
  "ID_IDENTITY_LABEL_V1",
  "STATEMENT_SOLICITATION_V1",
] as const;

export type PrivacyRuleFamily = (typeof privacyRuleFamilies)[number];

export const textDetectorBoundaries = [
  "device_draft_persistence",
  "server_draft_persistence",
  "memo_note_persistence",
  "label_persistence",
  "typed_text_ai_transmission",
  "transcript_persistence",
  "transcript_ai_transmission",
  "search_execution",
  "support_capture",
  "evidence_capture",
] as const;

export type TextDetectorBoundary = (typeof textDetectorBoundaries)[number];

export const rawVoiceBoundary = "raw_voice_stt_transmission" as const;
export const privacyTrustBoundaries = [...textDetectorBoundaries, rawVoiceBoundary] as const;
export type PrivacyTrustBoundary = (typeof privacyTrustBoundaries)[number];

export const privacyWarningCodes = [
  "REMOVE_SENSITIVE_INFORMATION_OR_ABANDON_CAPTURE",
  "PRIVACY_CHECK_UNAVAILABLE_TRY_AGAIN_OR_USE_STRUCTURED_ENTRY",
] as const;

export type PrivacyWarningCode = (typeof privacyWarningCodes)[number];

export interface PrivacyBoundaryEvaluation {
  /** Current content is consumed in-memory only and must not be retained by the port. */
  readonly content: string;
  readonly boundary: TextDetectorBoundary;
  readonly ruleSetVersion: string;
}

export interface PrivacyBoundaryAllowed {
  readonly decision: "allow";
  readonly matched: false;
  readonly ruleFamily: null;
  readonly warningCode: null;
}

export interface PrivacyBoundaryBlockedMatch {
  readonly decision: "block_match";
  readonly matched: true;
  /** Live control-flow only; forbidden from user-specific telemetry and diagnostics. */
  readonly ruleFamily: PrivacyRuleFamily;
  readonly warningCode: "REMOVE_SENSITIVE_INFORMATION_OR_ABANDON_CAPTURE";
}

export interface PrivacyBoundaryBlockedUnavailable {
  readonly decision: "block_unavailable";
  readonly matched: false;
  readonly ruleFamily: null;
  readonly warningCode: "PRIVACY_CHECK_UNAVAILABLE_TRY_AGAIN_OR_USE_STRUCTURED_ENTRY";
}

/** Contains no candidate, span, normalized material, hash, embedding, or explanation. */
export type PrivacyBoundaryResult =
  PrivacyBoundaryAllowed | PrivacyBoundaryBlockedMatch | PrivacyBoundaryBlockedUnavailable;

/**
 * Project-owned finite-detector port. Implementations must evaluate before crossing the named
 * boundary, discard all normalization/match material after evaluation, and fail closed when the
 * detector cannot produce a result. Arbitrary-language detection remains finite and best effort.
 */
export interface PrivacyBoundaryPort {
  evaluateText(evaluation: PrivacyBoundaryEvaluation): Promise<PrivacyBoundaryResult>;
}

export interface RawVoiceSttBoundaryControl {
  readonly consentVersion: string;
  readonly currentRecordingOnly: true;
  readonly detectorLimitationDisclosed: true;
  readonly mediaValidation: "passed";
}
