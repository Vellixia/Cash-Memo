import { describe, expect, it } from "vitest";

import { FAILURE_MATRIX, validateFailureMatrix } from "./failure-matrix.js";

describe("US5 executable failure matrix", () => {
  it("contains one complete content-free inventory across every required capability", () => {
    const result = validateFailureMatrix();
    expect(result.faultCount).toBe(45);
    expect(result.capabilities).toEqual([
      "ai_extraction",
      "authentication",
      "database",
      "email_delivery",
      "kms",
      "network",
      "object_storage",
      "reporting",
      "stt",
      "telemetry",
      "worker",
    ]);
  });

  it("declares retry, recovery, visible state, authority invariant, and evidence class", () => {
    for (const fault of FAILURE_MATRIX) {
      expect(typeof fault.retryAllowed).toBe("boolean");
      expect(typeof fault.localRecoveryAllowed).toBe("boolean");
      expect(fault.visibleProductState.length).toBeGreaterThan(0);
      expect(fault.authoritativeStateInvariant.length).toBeGreaterThan(0);
      expect(fault.evidenceClassification.length).toBeGreaterThan(0);
    }
  });

  it("uses only coarse identifiers and contains no user-content fields", () => {
    const serialized = JSON.stringify(FAILURE_MATRIX);
    expect(serialized).not.toMatch(
      /amount|audioData|body|categoryName|emailAddress|memoContent|note|payload|searchText|token|transcript/iu,
    );
  });

  it("rejects duplicate fault identifiers", () => {
    const first = FAILURE_MATRIX[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("FAILURE_MATRIX_EMPTY");
    expect(() => validateFailureMatrix([first, first])).toThrow("DUPLICATE_FAILURE_FAULT_ID");
  });
});
