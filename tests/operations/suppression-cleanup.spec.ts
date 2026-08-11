import { describe, expect, it } from "vitest";

import {
  AwsBackupLineageInventoryAdapter,
  ContractBackupLineageSource,
  type BackupArtifactClass,
} from "../../apps/server/src/adapters/aws/backup-lineage-inventory.adapter.js";
import {
  AwsDeletionSuppressionAdapter,
  ContractS3DeletionLedgerClient,
} from "../../apps/server/src/adapters/aws/deletion-suppression.adapter.js";
import { createSuppressionRecord } from "../../apps/server/src/modules/deletion/deletion-suppression.port.js";
import { SuppressionCleanupService } from "../../apps/server/src/modules/deletion/suppression-cleanup.service.js";
import { SuppressionKeyManager } from "../../apps/server/src/modules/deletion/suppression-key-manager.js";

const KEY1 = Buffer.from("synthetic-phase13-cleanup-key-material-v1", "utf8");
const KEY2 = Buffer.from("synthetic-phase13-cleanup-key-material-v2", "utf8");

async function fixture(now = new Date("2026-10-01T00:00:00.000Z")) {
  const client = new ContractS3DeletionLedgerClient();
  const ledger = new AwsDeletionSuppressionAdapter({
    bucket: "synthetic",
    client,
    kmsKeyId: "synthetic-kms",
  });
  const source = new ContractBackupLineageSource();
  const inventory = new AwsBackupLineageInventoryAdapter(source);
  const keys = new SuppressionKeyManager();
  keys.createVersion("key-v1", KEY1, new Date("2026-01-01T00:00:00.000Z"));
  keys.rotate("key-v2", KEY2, new Date("2026-07-01T00:00:00.000Z"));
  const record = createSuppressionRecord({
    entityId: "00000000-0000-4000-8000-000000000191",
    entityType: "money_memo",
    policyVersion: "phase13-v1",
    purgedAt: new Date("2026-08-01T00:00:00.000Z"),
    suppressionKey: KEY1,
    suppressionKeyVersion: "key-v1",
  });
  await ledger.ensureDurable(record);
  const service = new SuppressionCleanupService(ledger, inventory, keys, () => now);
  return { client, keys, ledger, record, service, source };
}

function present(
  artifactClass: BackupArtifactClass,
  state: "present" | "unverifiable" = "present",
) {
  return {
    artifactClass,
    capable: true,
    registered: true,
    requiresKeyVersions: ["key-v1"],
    state,
  } as const;
}

describe("verifier-controlled suppression cleanup", () => {
  it("retains before removal floor even when inventory is empty", async () => {
    const { record, service } = await fixture(new Date("2026-08-15T00:00:00.000Z"));
    await expect(service.verifyAndRemove(record.deletionToken, "key-v1")).resolves.toMatchObject({
      blocker: "floor_not_reached",
      removed: false,
    });
  });

  it.each(["manual_snapshot", "automated_pitr_window", "temporary_restore_copy"] as const)(
    "retains when capable %s remains after floor",
    async (artifactClass) => {
      const { record, service, source } = await fixture();
      source.setPagesForTest(artifactClass, [
        {
          artifacts: [present(artifactClass)],
          nextToken: null,
          source: artifactClass,
          sourceCurrent: true,
        },
      ]);
      await expect(service.verifyAndRemove(record.deletionToken, "key-v1")).resolves.toMatchObject({
        alert: true,
        blocker: "artifact_present",
        removed: false,
        retry: true,
      });
    },
  );

  it("retains and alerts on unavailable inventory", async () => {
    const { record, service, source } = await fixture();
    source.setUnavailableForTest(true);
    await expect(service.verifyAndRemove(record.deletionToken, "key-v1")).resolves.toMatchObject({
      alert: true,
      blocker: "inventory_not_authoritative",
      removed: false,
    });
  });

  it("retains and alerts on stale inventory", async () => {
    const { record, service, source } = await fixture();
    source.setPagesForTest("replica", [
      { artifacts: [], nextToken: null, source: "replica", sourceCurrent: false },
    ]);
    await expect(service.verifyAndRemove(record.deletionToken, "key-v1")).resolves.toMatchObject({
      alert: true,
      blocker: "inventory_not_authoritative",
      removed: false,
    });
  });

  it("retains on unverifiable artifact", async () => {
    const { record, service, source } = await fixture();
    source.setPagesForTest("shared_snapshot", [
      {
        artifacts: [present("shared_snapshot", "unverifiable")],
        nextToken: null,
        source: "shared_snapshot",
        sourceCurrent: true,
      },
    ]);
    await expect(service.verifyAndRemove(record.deletionToken, "key-v1")).resolves.toMatchObject({
      blocker: "artifact_present",
      removed: false,
    });
  });

  it("removes only after floor and complete current inventory proves no capable artifacts", async () => {
    const { ledger, record, service } = await fixture();
    await expect(service.verifyAndRemove(record.deletionToken, "key-v1")).resolves.toEqual({
      alert: false,
      blocker: null,
      removed: true,
      retry: false,
    });
    await expect(ledger.verifyDurable(record.deletionToken, "key-v1")).resolves.toBeNull();
  });

  it("rotation retains older keys for multi-version reconciliation", async () => {
    const { keys } = await fixture();
    expect(keys.getActive().version).toBe("key-v2");
    expect(keys.retainedVersions()).toEqual(["key-v1", "key-v2"]);
    expect(keys.getKey("key-v1")).toEqual(KEY1);
  });

  it("blocks premature key retirement while record or lineage may require it", async () => {
    const { keys } = await fixture();
    expect(() => {
      keys.retire("key-v1", {
        authoritativeInventoryComplete: true,
        lineageDependencies: 0,
        suppressionRecords: 1,
      });
    }).toThrow("SUPPRESSION_KEY_RETIREMENT_BLOCKED");
    expect(() => {
      keys.retire("key-v1", {
        authoritativeInventoryComplete: false,
        lineageDependencies: 0,
        suppressionRecords: 0,
      });
    }).toThrow("SUPPRESSION_KEY_RETIREMENT_BLOCKED");
    expect(() => {
      keys.retire("key-v1", {
        authoritativeInventoryComplete: true,
        lineageDependencies: 1,
        suppressionRecords: 0,
      });
    }).toThrow("SUPPRESSION_KEY_RETIREMENT_BLOCKED");
  });

  it("permits old-key retirement only after complete zero-dependency proof", async () => {
    const { keys } = await fixture();
    keys.retire("key-v1", {
      authoritativeInventoryComplete: true,
      lineageDependencies: 0,
      suppressionRecords: 0,
    });
    expect(keys.retainedVersions()).toEqual(["key-v2"]);
  });
});
