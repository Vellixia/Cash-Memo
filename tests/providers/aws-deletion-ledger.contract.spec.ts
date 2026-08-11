import { describe, expect, it } from "vitest";

import {
  AwsDeletionSuppressionAdapter,
  ContractS3DeletionLedgerClient,
  encodeRecord,
  objectKey,
} from "../../apps/server/src/adapters/aws/deletion-suppression.adapter.js";
import { createSuppressionRecord } from "../../apps/server/src/modules/deletion/deletion-suppression.port.js";

const KEY = Buffer.from("synthetic-phase13-ledger-key-material-v1", "utf8");
const ID = "00000000-0000-4000-8000-000000000185";

function fixture() {
  const client = new ContractS3DeletionLedgerClient();
  const adapter = new AwsDeletionSuppressionAdapter({
    bucket: "synthetic-ledger",
    client,
    kmsKeyId: "synthetic-kms-key",
  });
  const record = createSuppressionRecord({
    entityId: ID,
    entityType: "money_memo",
    policyVersion: "phase13-v1",
    purgedAt: new Date("2026-08-01T00:00:00.000Z"),
    suppressionKey: KEY,
    suppressionKeyVersion: "key-v1",
  });
  return { adapter, client, record };
}

describe("AWS deletion-ledger adapter contract", () => {
  it("uses conditional KMS-encrypted write and verifies durable object", async () => {
    const { adapter, client, record } = fixture();
    await expect(adapter.ensureDurable(record)).resolves.toMatchObject({ verifiedDurable: true });
    expect(client.lastPutForTest()).toMatchObject({
      ifNoneMatch: "*",
      kmsKeyId: "synthetic-kms-key",
      serverSideEncryption: "aws:kms",
    });
    await expect(adapter.verifyDurable(record.deletionToken, "key-v1")).resolves.toEqual(record);
  });

  it("makes same logical write idempotent", async () => {
    const { adapter, record } = fixture();
    await adapter.ensureDurable(record);
    await expect(adapter.ensureDurable(record)).resolves.toMatchObject({ verifiedDurable: true });
  });

  it("rejects conflicting material at same conditional key", async () => {
    const { adapter, record } = fixture();
    await adapter.ensureDurable(record);
    const conflict = { ...record, policyVersion: "conflict-v2" };
    await expect(adapter.ensureDurable(conflict)).rejects.toThrow(
      "SUPPRESSION_DURABILITY_UNVERIFIABLE",
    );
  });

  it("fails closed on write failure", async () => {
    const { adapter, client, record } = fixture();
    client.setFaultForTest("write_failure");
    await expect(adapter.ensureDurable(record)).rejects.toThrow("SUPPRESSION_DURABLE_WRITE_FAILED");
  });

  it("fails closed on ambiguous post-write verification", async () => {
    const { adapter, client, record } = fixture();
    client.setFaultForTest("ambiguous");
    await expect(adapter.ensureDurable(record)).rejects.toThrow(
      "SUPPRESSION_DURABILITY_UNVERIFIABLE",
    );
  });

  it("stores content-free record without raw entity identity or user content", async () => {
    const { adapter, client, record } = fixture();
    await adapter.ensureDurable(record);
    const body = client.storedBodiesForTest().join("");
    expect(body).not.toContain(ID);
    expect(body).not.toMatch(/email|amount|note|label|provider|auth.?token/iu);
    expect(body).toContain(record.deletionToken.toString("hex"));
  });

  it("contains no lifecycle TTL or elapsed-time deletion authority", () => {
    const { record } = fixture();
    const body = encodeRecord(record).toString("utf8");
    expect(body).not.toMatch(/expires_at|expiresAt|ttl|auto.?delete/iu);
    expect(body).toContain("removalNotBeforeAt");
  });

  it("uses opaque content-free object key", () => {
    const { record } = fixture();
    const key = objectKey(record.deletionToken, record.suppressionKeyVersion);
    expect(key).not.toContain(ID);
    expect(key).toMatch(/^suppression\/key-v1\/[0-9a-f]{64}\.json$/u);
  });

  it("requires verifier decision and exact version for privileged removal", async () => {
    const { adapter, record } = fixture();
    await adapter.ensureDurable(record);
    const loaded = await adapter.loadForCleanup(record.deletionToken, "key-v1");
    if (loaded === null) throw new Error("FIXTURE_MISSING");
    await expect(
      adapter.removeVerified({
        expectedVersionId: "wrong-version",
        suppressionKeyVersion: "key-v1",
        token: record.deletionToken,
        verifierDecision: "verified_eligible",
      }),
    ).rejects.toThrow("SUPPRESSION_REMOVAL_VERSION_CONFLICT");
    await adapter.removeVerified({
      expectedVersionId: loaded.versionId,
      suppressionKeyVersion: "key-v1",
      token: record.deletionToken,
      verifierDecision: "verified_eligible",
    });
    await expect(adapter.verifyDurable(record.deletionToken, "key-v1")).resolves.toBeNull();
  });
});
