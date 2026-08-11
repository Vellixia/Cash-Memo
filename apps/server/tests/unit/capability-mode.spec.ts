import { describe, expect, it, vi } from "vitest";

import {
  requireProviderInitialization,
  resolveCapabilityMode,
} from "../../src/bootstrap/capability-mode.js";

describe("provider-disabled capability mode", () => {
  it("starts intentional manual/core mode without provider or telemetry initialization", () => {
    expect(
      resolveCapabilityMode({ assistedCaptureMode: "disabled", telemetryConfigured: false }),
    ).toEqual({
      assistedCapture: "disabled",
      extraction: "disabled",
      manualJournal: "available",
      mode: "manual_core",
      shouldInitializeProviders: false,
      stt: "disabled",
      telemetry: "disabled",
    });
  });

  it("never initializes provider clients in disabled mode", () => {
    const providerFactory = vi.fn();
    const mode = resolveCapabilityMode({
      assistedCaptureMode: "disabled",
      telemetryConfigured: true,
    });
    if (mode.shouldInitializeProviders) {
      providerFactory();
    }
    expect(providerFactory).not.toHaveBeenCalled();
    expect(() => {
      requireProviderInitialization(mode);
    }).toThrow("PROVIDER_INITIALIZATION_DISABLED");
  });

  it("distinguishes provider expected but broken from disabled", () => {
    const mode = resolveCapabilityMode({
      assistedCaptureMode: "openai",
      providerConfigurationValid: false,
      telemetryConfigured: true,
    });
    expect(mode.assistedCapture).toBe("expected_but_broken");
    expect(mode.manualJournal).toBe("available");
    expect(mode.shouldInitializeProviders).toBe(false);
  });

  it("allows explicit fake contract mode without calling it production fallback", () => {
    const mode = resolveCapabilityMode({
      assistedCaptureMode: "fake",
      telemetryConfigured: false,
    });
    expect(mode).toMatchObject({
      assistedCapture: "available",
      mode: "provider_contract_test",
      shouldInitializeProviders: true,
    });
  });
});
