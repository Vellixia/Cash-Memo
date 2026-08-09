import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DiagnosticEventValidationError,
  buildDiagnosticEvent,
  type DiagnosticEvent,
  type DiagnosticEventInput,
} from "../src/telemetry/diagnostic-event.js";

const safeInput = {
  buildVersion: "2026.08.09-rc.1",
  correlationId: "018f0f50-b524-7c5f-8e89-0242ac120002",
  durationBucket: "lt_250ms",
  operation: "memo.create",
  outcome: "success",
  serviceHealth: "healthy",
} as const;

describe("allowlist-first diagnostic events", () => {
  it("builds only fixed, content-free fields", () => {
    const event = buildDiagnosticEvent(safeInput);
    expect(event).toEqual(safeInput);
    expect(Object.keys(event).sort()).toEqual([
      "buildVersion",
      "correlationId",
      "durationBucket",
      "operation",
      "outcome",
      "serviceHealth",
    ]);
    expect(Object.isFrozen(event)).toBe(true);
    expectTypeOf(event).toEqualTypeOf<DiagnosticEvent>();
  });

  it("accepts declared coarse queue and retry metadata", () => {
    expect(
      buildDiagnosticEvent({
        ...safeInput,
        queueDepthBucket: "low",
        retryCountBucket: "one",
      }),
    ).toMatchObject({ queueDepthBucket: "low", retryCountBucket: "one" });
  });

  it.each([
    "body",
    "requestBody",
    "responseBody",
    "query",
    "queryValue",
    "url",
    "secret",
    "detectorMaterial",
    "detectorCandidate",
    "amount",
    "note",
    "transcript",
    "audio",
    "providerPayload",
    "errorMessage",
    "attributes",
    "metadata",
    "context",
  ])("rejects forbidden or arbitrary runtime key %s", (forbiddenKey) => {
    const bypassedCompileTime = { ...safeInput, [forbiddenKey]: "PRIVATE_CANARY" };
    expect(() => buildDiagnosticEvent(bypassedCompileTime as DiagnosticEventInput)).toThrow(
      DiagnosticEventValidationError,
    );
  });

  it("rejects invalid enum, identifier, version, and prototype values", () => {
    for (const input of [
      { ...safeInput, operation: "memo.PRIVATE_CANARY" },
      { ...safeInput, outcome: "user-note" },
      { ...safeInput, correlationId: "not-a-uuid" },
      { ...safeInput, buildVersion: "https://example.invalid/?secret=value" },
      Object.assign(Object.create({ inherited: "PRIVATE_CANARY" }) as object, safeInput),
    ]) {
      expect(() => buildDiagnosticEvent(input as DiagnosticEventInput)).toThrow(
        DiagnosticEventValidationError,
      );
    }
  });

  it("has no compile-time body, query, secret, detector, or arbitrary object channel", () => {
    const compileOnly = (): void => {
      buildDiagnosticEvent(safeInput);
      buildDiagnosticEvent({
        ...safeInput,
        // @ts-expect-error body is forbidden by exact input contract
        body: "PRIVATE_CANARY",
      });
      buildDiagnosticEvent({
        ...safeInput,
        // @ts-expect-error query values are forbidden by exact input contract
        query: "PRIVATE_CANARY",
      });
      buildDiagnosticEvent({
        ...safeInput,
        // @ts-expect-error secrets are forbidden by exact input contract
        secret: "PRIVATE_CANARY",
      });
      buildDiagnosticEvent({
        ...safeInput,
        // @ts-expect-error detector material is forbidden by exact input contract
        detectorMaterial: "PRIVATE_CANARY",
      });
      buildDiagnosticEvent({
        ...safeInput,
        // @ts-expect-error arbitrary nested attributes are forbidden by exact input contract
        attributes: { arbitrary: "PRIVATE_CANARY" },
      });
    };

    expectTypeOf(compileOnly).toBeFunction();
  });
});
