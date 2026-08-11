export const providerConsentValues = {
  textExtraction: "SEND_THIS_TEXT_FOR_AI_EXTRACTION",
  transcriptExtraction: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION",
  voiceStt: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION",
} as const;

export type ProviderConsentOperation = keyof typeof providerConsentValues;

export class ProviderConsentError extends Error {
  readonly code = "PROVIDER_CONSENT_REQUIRED";

  constructor() {
    super("Provider consent required.");
    this.name = "ProviderConsentError";
  }
}

export function requireProviderConsent(
  operation: ProviderConsentOperation,
  provided: string,
): void {
  if (provided !== providerConsentValues[operation]) throw new ProviderConsentError();
}

export interface VoiceDetectorLimitationDisclosure {
  readonly acknowledged: boolean;
  readonly code: string;
}

export function requireVoiceLimitationDisclosure(
  disclosure: VoiceDetectorLimitationDisclosure,
): void {
  if (
    !disclosure.acknowledged ||
    disclosure.code !== "RAW_VOICE_REACHES_STT_BEFORE_TEXT_DETECTION"
  ) {
    throw new ProviderConsentError();
  }
}
