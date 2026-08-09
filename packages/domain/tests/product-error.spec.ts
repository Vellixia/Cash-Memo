import { describe, expect, it } from "vitest";

import {
  ProductErrorConstructionError,
  createProductError,
  productErrorCodes,
  type ProductErrorCode,
  type ProductErrorOptions,
} from "@cashmemo/domain";

function errorFor(code: ProductErrorCode) {
  if (code === "RESULTS_CHANGED") {
    return createProductError(code, { currentResultSetVersion: "2" });
  }
  if (code === "RATE_LIMITED") return createProductError(code, { retryAfterSeconds: 30 });
  return createProductError(code);
}

describe("privacy-safe product errors", () => {
  it("constructs every stable product code with a stable message code", () => {
    for (const code of productErrorCodes) {
      const error = errorFor(code);

      expect(error.code).toBe(code);
      expect(error.messageCode).toMatch(/^[A-Z0-9_]+$/u);
    }
  });

  it("enforces code-specific revision, traversal, validation, and retry metadata", () => {
    expect(() => createProductError("RESULTS_CHANGED")).toThrow(ProductErrorConstructionError);
    expect(() => createProductError("RATE_LIMITED")).toThrow(ProductErrorConstructionError);
    expect(() => createProductError("NOT_FOUND", { currentRevision: "1" })).toThrow(
      ProductErrorConstructionError,
    );
    expect(() =>
      createProductError("AUTH_FAILED", {
        fieldErrors: [{ field: "email", reason: "INVALID" }],
      }),
    ).toThrow(ProductErrorConstructionError);
  });

  it("retains only allowlisted field-error metadata", () => {
    const candidate = "candidate-provider-or-input-content";
    const unsafeRuntimeOptions = {
      fieldErrors: [{ field: "email", providerPayload: candidate, reason: "INVALID" }],
    } as unknown as ProductErrorOptions;
    const error = createProductError("VALIDATION_FAILED", unsafeRuntimeOptions);
    const serialized = JSON.stringify(error);

    expect(serialized).not.toContain(candidate);
    expect(error.fieldErrors).toEqual([{ field: "email", reason: "INVALID" }]);
  });
});
