import { describe, expect, it } from "vitest";

import {
  AwsBackupLineageInventoryAdapter,
  ContractBackupLineageSource,
  REQUIRED_ARTIFACT_CLASSES,
  type BackupArtifact,
  type BackupArtifactClass,
} from "../../apps/server/src/adapters/aws/backup-lineage-inventory.adapter.js";

function artifact(
  artifactClass: BackupArtifactClass,
  state: BackupArtifact["state"] = "present",
): BackupArtifact {
  return { artifactClass, capable: true, registered: true, requiresKeyVersions: ["key-v1"], state };
}

describe("AWS backup-lineage inventory contract", () => {
  it("inventories every resurrection-capable artifact class even when empty", async () => {
    const result = await new AwsBackupLineageInventoryAdapter(
      new ContractBackupLineageSource(),
    ).inventory();
    expect(result.state).toBe("complete_current");
    expect(result.checkedClasses).toEqual(REQUIRED_ARTIFACT_CLASSES);
    expect(result.checkedClasses).toHaveLength(10);
  });

  it("normalizes capable and known non-capable artifacts", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("manual_snapshot", [
      {
        artifacts: [
          artifact("manual_snapshot"),
          { ...artifact("manual_snapshot", "destroyed"), capable: false },
        ],
        nextToken: null,
        source: "manual_snapshot",
        sourceCurrent: true,
      },
    ]);
    const result = await new AwsBackupLineageInventoryAdapter(source).inventory();
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capable: true, state: "present" }),
        expect.objectContaining({ capable: false, state: "destroyed" }),
      ]),
    );
  });

  it("preserves unverifiable artifact state", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("shared_snapshot", [
      {
        artifacts: [artifact("shared_snapshot", "unverifiable")],
        nextToken: null,
        source: "shared_snapshot",
        sourceCurrent: true,
      },
    ]);
    const result = await new AwsBackupLineageInventoryAdapter(source).inventory();
    expect(result.artifacts[0]?.state).toBe("unverifiable");
  });

  it("returns unavailable instead of an empty safe inventory on API failure", async () => {
    const source = new ContractBackupLineageSource();
    source.setUnavailableForTest(true);
    await expect(new AwsBackupLineageInventoryAdapter(source).inventory()).resolves.toMatchObject({
      state: "unavailable",
    });
  });

  it("returns stale/incomplete when a source is not current", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("replica", [
      { artifacts: [], nextToken: null, source: "replica", sourceCurrent: false },
    ]);
    await expect(new AwsBackupLineageInventoryAdapter(source).inventory()).resolves.toMatchObject({
      state: "stale_incomplete",
    });
  });

  it("consumes every page before declaring inventory complete", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("aws_backup_recovery_point", [
      {
        artifacts: [artifact("aws_backup_recovery_point")],
        nextToken: "1",
        source: "aws_backup_recovery_point",
        sourceCurrent: true,
      },
      {
        artifacts: [artifact("aws_backup_recovery_point", "destroyed")],
        nextToken: null,
        source: "aws_backup_recovery_point",
        sourceCurrent: true,
      },
    ]);
    const result = await new AwsBackupLineageInventoryAdapter(source).inventory();
    expect(result.state).toBe("complete_current");
    expect(
      result.artifacts.filter((item) => item.artifactClass === "aws_backup_recovery_point"),
    ).toHaveLength(2);
  });
});
