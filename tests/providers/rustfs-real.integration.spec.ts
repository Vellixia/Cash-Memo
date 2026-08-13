import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { RustfsExportObjectStoreAdapter } from "../../apps/server/src/adapters/rustfs/export-object-store.adapter.js";
import { RustfsDeletionSuppressionAdapter } from "../../apps/server/src/adapters/rustfs/deletion-suppression.adapter.js";
import {
  RustfsMinioDeletionLedgerClient,
  RustfsMinioExportClient,
} from "../../apps/server/src/adapters/rustfs/minio-s3-compatible.client.js";
import { createSuppressionRecord } from "../../apps/server/src/modules/deletion/deletion-suppression.port.js";

const enabled = process.env["CASHMEMO_RUSTFS_REAL_INTEGRATION"] === "1";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`MISSING_SAFE_CONFIG_NAME:${name}`);
  return value;
}

describe.skipIf(!enabled)("pinned RustFS real-service semantics", () => {
  it("proves Primary put/head/get/version enumeration/every-version delete", async () => {
    const client = new RustfsMinioExportClient({
      accessKey: required("RUSTFS_PRIMARY_ACCESS_KEY"),
      endpoint: required("RUSTFS_PRIMARY_ENDPOINT"),
      region: required("RUSTFS_PRIMARY_REGION"),
      secretKey: required("RUSTFS_PRIMARY_SECRET_KEY"),
    });
    const store = new RustfsExportObjectStoreAdapter({
      bucket: required("RUSTFS_EXPORT_BUCKET"),
      client,
    });
    const body = Buffer.from("synthetic-rustfs-export-fixture-v1", "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const scope = createHash("sha256").update("synthetic-scope").digest("hex");
    const handle = await store.putPrivateExport({
      accountScopeHmac: scope,
      body,
      expectedSha256: sha256,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    const stream = await store.openPrivateStream(scope, handle.key, sha256);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks)).toEqual(body);
    expect(await store.listVersions(scope, handle.key)).not.toHaveLength(0);
    await expect(store.deleteEveryVersion(scope, handle.key)).resolves.toMatchObject({
      residualVersions: 0,
    });
  });

  it("proves Secondary conditional durability, read verification, and privileged removal", async () => {
    const client = new RustfsMinioDeletionLedgerClient({
      accessKey: required("RUSTFS_SECONDARY_ACCESS_KEY"),
      encryptedStoragePolicyVerified: true,
      endpoint: required("RUSTFS_SECONDARY_ENDPOINT"),
      region: required("RUSTFS_SECONDARY_REGION"),
      secretKey: required("RUSTFS_SECONDARY_SECRET_KEY"),
    });
    const ledger = new RustfsDeletionSuppressionAdapter({
      bucket: required("RUSTFS_SECONDARY_BUCKET"),
      client,
    });
    const record = createSuppressionRecord({
      entityId: "00000000-0000-4000-8000-000000000185",
      entityType: "money_memo",
      policyVersion: "rustfs-real-v1",
      purgedAt: new Date("2026-08-13T00:00:00.000Z"),
      suppressionKey: Buffer.from("synthetic-rustfs-real-ledger-key-v1", "utf8"),
      suppressionKeyVersion: "key-v1",
    });
    await expect(ledger.ensureDurable(record)).resolves.toMatchObject({ verifiedDurable: true });
    await expect(ledger.ensureDurable(record)).resolves.toMatchObject({ verifiedDurable: true });
    const loaded = await ledger.loadForCleanup(record.deletionToken, record.suppressionKeyVersion);
    if (loaded === null) throw new Error("REAL_LEDGER_RECORD_MISSING");
    await ledger.removeVerified({
      expectedVersionId: loaded.versionId,
      suppressionKeyVersion: record.suppressionKeyVersion,
      token: record.deletionToken,
      verifierDecision: "verified_eligible",
    });
    await expect(
      ledger.verifyDurable(record.deletionToken, record.suppressionKeyVersion),
    ).resolves.toBeNull();
  });
});
