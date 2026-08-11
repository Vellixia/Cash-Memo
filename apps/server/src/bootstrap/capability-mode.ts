export type AssistedCapabilityMode = "disabled" | "fake" | "openai";
export type ProductCapabilityState = "available" | "disabled" | "expected_but_broken";

export interface CapabilityMode {
  readonly assistedCapture: ProductCapabilityState;
  readonly extraction: ProductCapabilityState;
  readonly manualJournal: "available";
  readonly mode: "manual_core" | "provider_contract_test" | "provider_enabled";
  readonly shouldInitializeProviders: boolean;
  readonly stt: ProductCapabilityState;
  readonly telemetry: "available" | "degraded" | "disabled";
}

export function resolveCapabilityMode(input: {
  readonly assistedCaptureMode: AssistedCapabilityMode;
  readonly providerConfigurationValid?: boolean;
  readonly telemetryConfigured: boolean;
}): CapabilityMode {
  const telemetry = input.telemetryConfigured ? "available" : "disabled";
  if (input.assistedCaptureMode === "disabled") {
    return Object.freeze({
      assistedCapture: "disabled",
      extraction: "disabled",
      manualJournal: "available",
      mode: "manual_core",
      shouldInitializeProviders: false,
      stt: "disabled",
      telemetry,
    });
  }
  if (input.assistedCaptureMode === "openai" && input.providerConfigurationValid !== true) {
    return Object.freeze({
      assistedCapture: "expected_but_broken",
      extraction: "expected_but_broken",
      manualJournal: "available",
      mode: "provider_enabled",
      shouldInitializeProviders: false,
      stt: "expected_but_broken",
      telemetry,
    });
  }
  const state = "available" as const;
  return Object.freeze({
    assistedCapture: state,
    extraction: state,
    manualJournal: "available",
    mode: input.assistedCaptureMode === "fake" ? "provider_contract_test" : "provider_enabled",
    shouldInitializeProviders: true,
    stt: state,
    telemetry,
  });
}

export function requireProviderInitialization(mode: CapabilityMode): void {
  if (!mode.shouldInitializeProviders) throw new Error("PROVIDER_INITIALIZATION_DISABLED");
}
