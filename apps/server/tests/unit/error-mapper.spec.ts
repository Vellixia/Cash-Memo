import {
  createProductError,
  productErrorCodes,
  type ProductErrorCode,
  type ProductErrorOptions,
} from "@cashmemo/domain";
import { describe, expect, it } from "vitest";

import {
  UnsafeErrorMappingAttempt,
  mapProductError,
  statusByCode,
} from "../../src/adapters/http/error-mapper.js";

const correlationId = "00000000-0000-4000-8000-000000000001";

function errorFor(code: ProductErrorCode) {
  if (code === "RESULTS_CHANGED") {
    return createProductError(code, { currentResultSetVersion: "2" });
  }
  if (code === "RATE_LIMITED") return createProductError(code, { retryAfterSeconds: 30 });
  return createProductError(code);
}

describe("HTTP product error mapper", () => {
  it("maps every stable product code to a declared HTTP status", () => {
    for (const code of productErrorCodes) {
      const mapped = mapProductError(errorFor(code), correlationId);

      expect(mapped.statusCode).toBe(statusByCode[code]);
      expect(mapped.body.code).toBe(code);
      expect(mapped.body.correlationId).toBe(correlationId);
      expect(mapped.body.messageCode).toMatch(/^[A-Z0-9_]+$/u);
    }
  });

  it("serializes only allowlisted fields and never echoes candidate content", () => {
    const candidate = "candidate-provider-or-input-content";
    const unsafeRuntimeOptions = {
      fieldErrors: [{ field: "email", providerPayload: candidate, reason: "INVALID" }],
    } as unknown as ProductErrorOptions;
    const mapped = mapProductError(
      createProductError("VALIDATION_FAILED", unsafeRuntimeOptions),
      correlationId,
    );
    const serialized = JSON.stringify(mapped);

    expect(serialized).not.toContain(candidate);
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
    expect(Object.keys(mapped.body).sort()).toEqual([
      "code",
      "correlationId",
      "currentResultSetVersion",
      "currentRevision",
      "fieldErrors",
      "messageCode",
      "restartRequired",
      "retryAfterSeconds",
      "retryable",
    ]);
  });

  it("rejects arbitrary errors and invalid correlation identifiers without echoing them", () => {
    const candidate = "provider-payload-must-not-appear";

    expect(() => mapProductError(new Error(candidate), correlationId)).toThrow(
      UnsafeErrorMappingAttempt,
    );
    expect(() => mapProductError(createProductError("AUTH_FAILED"), candidate)).toThrow(
      UnsafeErrorMappingAttempt,
    );
  });
});
