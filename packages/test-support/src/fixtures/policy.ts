const FIXTURE_KIND_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
const FIXTURE_ID_PATTERN = /^syn:[a-z][a-z0-9-]{0,31}:[0-9]{6}$/u;
const MAX_FIXTURE_ORDINAL = 999_999;

declare const safeFixtureIdBrand: unique symbol;

type SafeFixtureId = string & { readonly [safeFixtureIdBrand]: true };

type FixturePolicyErrorCode =
  | "FIXTURE_ID_INVALID"
  | "FIXTURE_KIND_INVALID"
  | "FIXTURE_ORDINAL_INVALID"
  | "FIXTURE_POLICY_DISABLED"
  | "FIXTURE_PRODUCTION_DATA_REJECTED"
  | "FIXTURE_PRODUCTION_ENVIRONMENT_REJECTED"
  | "FIXTURE_PROVENANCE_REJECTED";

interface SyntheticFixturePolicyInput {
  allowSyntheticFixtures: true;
  containsProductionData: false;
  dataClass: "synthetic";
  executionEnvironment: "development" | "test" | "ci";
  fixtureId: SafeFixtureId;
  provenance: "generated";
}

class FixturePolicyError extends Error {
  readonly code: FixturePolicyErrorCode;

  constructor(code: FixturePolicyErrorCode) {
    super(`Synthetic fixture policy rejected the candidate (${code}).`);
    this.name = "FixturePolicyError";
    this.code = code;
  }
}

function createSafeFixtureId(kind: string, ordinal: number): SafeFixtureId {
  if (!FIXTURE_KIND_PATTERN.test(kind)) {
    throw new FixturePolicyError("FIXTURE_KIND_INVALID");
  }
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > MAX_FIXTURE_ORDINAL) {
    throw new FixturePolicyError("FIXTURE_ORDINAL_INVALID");
  }

  return `syn:${kind}:${String(ordinal).padStart(6, "0")}` as SafeFixtureId;
}

function assertSyntheticFixturePolicy(
  candidate: unknown,
): asserts candidate is SyntheticFixturePolicyInput {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new FixturePolicyError("FIXTURE_PROVENANCE_REJECTED");
  }

  const fields = candidate as Record<string, unknown>;
  if (fields["executionEnvironment"] === "production") {
    throw new FixturePolicyError("FIXTURE_PRODUCTION_ENVIRONMENT_REJECTED");
  }
  if (fields["allowSyntheticFixtures"] !== true) {
    throw new FixturePolicyError("FIXTURE_POLICY_DISABLED");
  }
  // This is an explicit provenance control, not a claim that arbitrary content
  // can be classified semantically as synthetic or production data.
  if (fields["containsProductionData"] !== false || fields["dataClass"] !== "synthetic") {
    throw new FixturePolicyError("FIXTURE_PRODUCTION_DATA_REJECTED");
  }
  if (fields["provenance"] !== "generated") {
    throw new FixturePolicyError("FIXTURE_PROVENANCE_REJECTED");
  }
  if (typeof fields["fixtureId"] !== "string" || !FIXTURE_ID_PATTERN.test(fields["fixtureId"])) {
    throw new FixturePolicyError("FIXTURE_ID_INVALID");
  }
  if (!new Set(["development", "test", "ci"]).has(String(fields["executionEnvironment"]))) {
    throw new FixturePolicyError("FIXTURE_PRODUCTION_ENVIRONMENT_REJECTED");
  }
}

export {
  FixturePolicyError,
  assertSyntheticFixturePolicy,
  createSafeFixtureId,
  type SafeFixtureId,
  type SyntheticFixturePolicyInput,
};
