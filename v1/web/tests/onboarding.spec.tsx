import { describe, expect, it } from "vitest";
import { onboardingComplete, onboardingNextStep } from "../features/onboarding/use-onboarding";

describe("derived onboarding", () => {
  it("only completes when every backend fact is true", () => {
    expect(onboardingComplete({ timezone_configured: true, default_currency_configured: true, categories_seeded: true, has_active_wallet: true })).toBe(true);
    expect(onboardingComplete({ timezone_configured: true, default_currency_configured: true, categories_seeded: true, has_active_wallet: false })).toBe(false);
  });

  it("returns missing step from server facts, so interruption is safe", () => {
    expect(onboardingNextStep({ timezone_configured: false, default_currency_configured: true, categories_seeded: true, has_active_wallet: true })).toBe("timezone");
    expect(onboardingNextStep({ timezone_configured: true, default_currency_configured: false, categories_seeded: true, has_active_wallet: true })).toBe("currency");
    expect(onboardingNextStep({ timezone_configured: true, default_currency_configured: true, categories_seeded: false, has_active_wallet: true })).toBe("categories");
    expect(onboardingNextStep({ timezone_configured: true, default_currency_configured: true, categories_seeded: true, has_active_wallet: false })).toBe("wallet");
  });
});
