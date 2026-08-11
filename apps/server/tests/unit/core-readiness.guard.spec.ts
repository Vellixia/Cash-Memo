import { describe, expect, it, vi } from "vitest";

import {
  CoreReadinessError,
  CoreReadinessGuard,
  coreReadiness,
} from "../../src/bootstrap/core-readiness.guard.js";

const ready = {
  auth: true,
  persistence: true,
  requiredDependencies: true,
  schemaCompatible: true,
};

describe("core readiness authority guard", () => {
  it.each([
    [{ ...ready, persistence: false }, "persistence_unavailable"],
    [{ ...ready, auth: false }, "auth_unavailable"],
    [{ ...ready, schemaCompatible: false }, "schema_incompatible"],
    [{ ...ready, requiredDependencies: false }, "core_dependency_unavailable"],
  ] as const)("maps required core outage to %s", (snapshot, expected) => {
    expect(coreReadiness(snapshot)).toBe(expected);
  });

  it("executes authoritative operation only when every core dependency is ready", async () => {
    const operation = vi.fn(() => Promise.resolve("saved"));
    const guard = new CoreReadinessGuard(() => Promise.resolve(ready));
    await expect(guard.executeAuthoritative(operation)).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("fails closed before an operation and exposes no internal dependency details", async () => {
    const operation = vi.fn(() => Promise.resolve("saved"));
    const guard = new CoreReadinessGuard(() => Promise.resolve({ ...ready, persistence: false }));
    await expect(guard.executeAuthoritative(operation)).rejects.toEqual(
      new CoreReadinessError("persistence_unavailable"),
    );
    expect(operation).not.toHaveBeenCalled();
    await expect(guard.requireAuthority()).rejects.toMatchObject({
      message: "CORE_OPERATION_UNAVAILABLE",
      statusCode: 503,
    });
  });
});
