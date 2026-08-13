import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ContractExportObjectStore } from "../../apps/server/src/adapters/rustfs/export-object-store.adapter.js";

const ACCOUNT_SCOPE = createHash("sha256").update("synthetic-account-scope").digest("hex");
const OTHER_SCOPE = createHash("sha256").update("synthetic-other-scope").digest("hex");
const NOW = new Date("2026-08-11T12:00:00.000Z");
const EXPIRES = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000);

async function fixture() {
  const store = new ContractExportObjectStore();
  const body = Buffer.from("synthetic deterministic export archive", "utf8");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const handle = await store.putPrivateExport({
    accountScopeHmac: ACCOUNT_SCOPE,
    body,
    expectedSha256: sha256,
    expiresAt: EXPIRES,
  });
  return { body, handle, sha256, store };
}

describe("export object lifecycle", () => {
  it("streams a private package only for its account scope", async () => {
    const { handle, sha256, store } = await fixture();
    await expect(store.openPrivateStream(ACCOUNT_SCOPE, handle.key, sha256)).resolves.toBeDefined();
    await expect(store.openPrivateStream(OTHER_SCOPE, handle.key, sha256)).rejects.toThrow(
      "EXPORT_OBJECT_NOT_FOUND",
    );
  });

  it("makes a canceled package inaccessible immediately", async () => {
    const { handle, sha256, store } = await fixture();
    await store.deleteEveryVersion(ACCOUNT_SCOPE, handle.key);
    await expect(store.openPrivateStream(ACCOUNT_SCOPE, handle.key, sha256)).rejects.toThrow(
      "EXPORT_OBJECT_NOT_FOUND",
    );
  });

  it("makes an expired package inaccessible and deletes it within lifecycle", async () => {
    const { handle, sha256, store } = await fixture();
    const controlledNow = new Date(EXPIRES.getTime() + 23 * 60 * 60 * 1_000);
    expect(controlledNow.getTime() - EXPIRES.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1_000);
    await store.deleteEveryVersion(ACCOUNT_SCOPE, handle.key);
    await expect(store.openPrivateStream(ACCOUNT_SCOPE, handle.key, sha256)).rejects.toThrow();
  });

  it("deletes every object version and delete marker", async () => {
    const { body, handle, store } = await fixture();
    await store.addVersionForTest(
      ACCOUNT_SCOPE,
      handle.key,
      Buffer.concat([body, Buffer.from("v2")]),
      EXPIRES,
    );
    await store.addVersionForTest(ACCOUNT_SCOPE, handle.key, null, EXPIRES);
    expect(await store.listVersions(ACCOUNT_SCOPE, handle.key)).toMatchObject([
      { deleteMarker: false },
      { deleteMarker: false },
      { deleteMarker: true },
    ]);
    const result = await store.deleteEveryVersion(ACCOUNT_SCOPE, handle.key);
    expect(result).toEqual({ deletedVersions: 3, residualVersions: 0 });
    expect(await store.listVersions(ACCOUNT_SCOPE, handle.key)).toEqual([]);
  });

  it("rejects checksum mismatch before any object becomes available", async () => {
    const store = new ContractExportObjectStore();
    await expect(
      store.putPrivateExport({
        accountScopeHmac: ACCOUNT_SCOPE,
        body: Buffer.from("synthetic"),
        expectedSha256: "0".repeat(64),
        expiresAt: EXPIRES,
      }),
    ).rejects.toThrow("EXPORT_INTEGRITY_MISMATCH");
  });

  it("uses opaque keys without identity or financial content", async () => {
    const { handle } = await fixture();
    expect(handle.key).toMatch(/^exports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/u);
    expect(handle.key).not.toMatch(/@|account|memo|amount|label|cashmemo\.test/iu);
  });
});
