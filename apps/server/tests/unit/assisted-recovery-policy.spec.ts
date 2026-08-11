import { describe, expect, it } from "vitest";

import { assistedRecoveryPolicy } from "../../src/modules/assisted-capture/recovery-policy.js";

describe("partial assisted-capture recovery policy", () => {
  it("retains declared transcript draft when extraction becomes unavailable", () => {
    expect(
      assistedRecoveryPolicy({
        failure: "unavailable",
        stage: "extraction",
        transcriptAvailable: true,
      }),
    ).toMatchObject({
      authoritative: false,
      confirmedMemoMutationAllowed: false,
      retainTranscriptUntilDeclaredExpiry: true,
      state: "failed_recoverable",
    });
  });

  it("marks incomplete STT as correction-required and never auto-confirms", () => {
    expect(
      assistedRecoveryPolicy({
        failure: "incomplete",
        stage: "stt",
        transcriptAvailable: true,
      }),
    ).toMatchObject({
      errorCode: "STT_INCOMPLETE",
      confirmedMemoMutationAllowed: false,
      state: "correction_required",
    });
  });

  it("maps partial extraction to visible correction state", () => {
    expect(
      assistedRecoveryPolicy({
        failure: "partial",
        stage: "extraction",
        transcriptAvailable: true,
      }),
    ).toMatchObject({ errorCode: "AI_INCOMPLETE_OUTPUT", state: "correction_required" });
  });

  it("never extends raw audio retention for downstream failure", () => {
    for (const stage of ["stt", "extraction"] as const) {
      expect(
        assistedRecoveryPolicy({ failure: "timeout", stage, transcriptAvailable: false })
          .audioRetentionExtended,
      ).toBe(false);
    }
  });

  it("provider failure has no confirmed-record mutation path", () => {
    for (const failure of [
      "timeout",
      "rate_limit",
      "refusal",
      "invalid_schema",
      "partial",
      "incomplete",
      "unavailable",
    ] as const) {
      expect(
        assistedRecoveryPolicy({ failure, stage: "extraction", transcriptAvailable: true })
          .confirmedMemoMutationAllowed,
      ).toBe(false);
    }
  });
});
