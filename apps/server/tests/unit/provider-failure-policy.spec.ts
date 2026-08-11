import { describe, expect, it } from "vitest";

import { providerFailure } from "../../src/modules/assisted-capture/provider-failure-policy.js";

describe("assisted provider failure policy", () => {
  it.each([
    ["timeout", "AI_TIMEOUT", true],
    ["rate_limit", "AI_RATE_LIMITED", true],
    ["refusal", "AI_REFUSED", false],
    ["invalid_schema", "AI_INVALID_OUTPUT", false],
    ["incomplete", "AI_INCOMPLETE_OUTPUT", false],
    ["unavailable", "AI_UNAVAILABLE", true],
  ] as const)("maps AI %s to stable content-free state", (state, code, retryable) => {
    expect(providerFailure("AI", state, 1)).toEqual({ capability: "AI", code, retryable });
  });

  it("caps provider retries at two attempts", () => {
    expect(providerFailure("STT", "timeout", 2)).toMatchObject({
      code: "STT_TIMEOUT",
      retryable: false,
    });
  });
});
