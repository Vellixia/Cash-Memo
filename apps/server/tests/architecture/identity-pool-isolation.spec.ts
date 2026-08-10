import { describe, expect, it } from "vitest";

describe("identity pool isolation", () => {
  it("prevents non-identity modules from importing the identity pool", async () => {
    await expect(import("../../src/adapters/postgres/identity-pool.js")).resolves.toBeDefined();
  });

  it("ensures identity pool module exports only pool lifecycle functions", async () => {
    const mod = await import("../../src/adapters/postgres/identity-pool.js");
    const exports = Object.keys(mod).sort();
    expect(exports).toEqual(["createIdentityPool", "destroyIdentityPool", "getIdentityPool"]);
  });

  it("ensures transaction-context does not import identity pool", async () => {
    const source = await import("../../src/adapters/postgres/transaction-context.js");
    expect(source).not.toHaveProperty("getIdentityPool");
    expect(source).not.toHaveProperty("createIdentityPool");
  });
});
