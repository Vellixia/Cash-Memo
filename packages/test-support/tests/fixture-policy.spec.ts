import { describe, expect, it } from "vitest";

import {
  FixturePolicyError,
  assertSyntheticFixturePolicy,
  createSafeFixtureId,
} from "../src/fixtures/policy.js";

describe("synthetic fixture policy", () => {
  it("creates content-independent, bounded fixture IDs", () => {
    expect(createSafeFixtureId("money-memo", 7)).toBe("syn:money-memo:000007");
    expect(createSafeFixtureId("account", 999_999)).toBe("syn:account:999999");
    expect(() => createSafeFixtureId("Money Memo", 1)).toThrow(FixturePolicyError);
    expect(() => createSafeFixtureId("memo", 0)).toThrow(FixturePolicyError);
    expect(() => createSafeFixtureId("memo", 1_000_000)).toThrow(FixturePolicyError);
  });

  it("accepts explicit generated synthetic provenance outside production", () => {
    expect(() => {
      assertSyntheticFixturePolicy({
        allowSyntheticFixtures: true,
        containsProductionData: false,
        dataClass: "synthetic",
        executionEnvironment: "test",
        fixtureId: createSafeFixtureId("memo", 1),
        provenance: "generated",
      });
    }).not.toThrow();
  });

  it.each([
    ["production environment", { executionEnvironment: "production" }],
    ["missing opt-in", { allowSyntheticFixtures: false }],
    ["production-data claim", { containsProductionData: true }],
    ["non-synthetic class", { dataClass: "production" }],
    ["captured provenance", { provenance: "captured" }],
    ["unsafe identifier", { fixtureId: "user@example.test" }],
  ])("rejects %s", (_caseName, override) => {
    const candidate = {
      allowSyntheticFixtures: true,
      containsProductionData: false,
      dataClass: "synthetic",
      executionEnvironment: "test",
      fixtureId: createSafeFixtureId("memo", 1),
      provenance: "generated",
      ...override,
    };

    expect(() => {
      assertSyntheticFixturePolicy(candidate);
    }).toThrow(FixturePolicyError);
  });

  it("never includes rejected candidate values in policy errors", () => {
    const rejectedValue = "candidate-value-must-not-appear";

    try {
      assertSyntheticFixturePolicy({
        allowSyntheticFixtures: true,
        containsProductionData: false,
        dataClass: "synthetic",
        executionEnvironment: "test",
        fixtureId: rejectedValue,
        provenance: "generated",
      });
      throw new Error("Expected fixture policy rejection");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(FixturePolicyError);
      expect((error as Error).message).not.toContain(rejectedValue);
    }
  });
});
