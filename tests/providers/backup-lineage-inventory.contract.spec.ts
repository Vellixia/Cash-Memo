import { describe, expect, it } from "vitest";

import {
  BackupLineageInventoryAdapter,
  ContractBackupLineageSource,
  REQUIRED_ARTIFACT_CLASSES,
  type BackupArtifact,
  type BackupArtifactClass,
} from "../../apps/server/src/adapters/backup/backup-lineage-inventory.adapter.js";

function artifact(
  artifactClass: BackupArtifactClass,
  state: BackupArtifact["state"] = "present",
): BackupArtifact {
  return { artifactClass, capable: true, registered: true, requiresKeyVersions: ["key-v1"], state };
}

describe("self-hosted backup-lineage inventory contract", () => {
  it("inventories every resurrection-capable artifact class even when empty", async () => {
    const result = await new BackupLineageInventoryAdapter(
      new ContractBackupLineageSource(),
    ).inventory();
    expect(result.state).toBe("complete_current");
    expect(result.checkedClasses).toEqual(REQUIRED_ARTIFACT_CLASSES);
    expect(result.checkedClasses).toHaveLength(10);
  });

  it("normalizes capable and known non-capable artifacts", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("manual_operator_copy", [
      {
        artifacts: [
          artifact("manual_operator_copy"),
          { ...artifact("manual_operator_copy", "destroyed"), capable: false },
        ],
        nextToken: null,
        source: "manual_operator_copy",
        sourceCurrent: true,
      },
    ]);
    const result = await new BackupLineageInventoryAdapter(source).inventory();
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capable: true, state: "present" }),
        expect.objectContaining({ capable: false, state: "destroyed" }),
      ]),
    );
  });

  it("preserves unverifiable artifact state", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("volume_snapshot", [
      {
        artifacts: [artifact("volume_snapshot", "unverifiable")],
        nextToken: null,
        source: "volume_snapshot",
        sourceCurrent: true,
      },
    ]);
    const result = await new BackupLineageInventoryAdapter(source).inventory();
    expect(result.artifacts[0]?.state).toBe("unverifiable");
  });

  it("returns unavailable instead of an empty safe inventory on API failure", async () => {
    const source = new ContractBackupLineageSource();
    source.setUnavailableForTest(true);
    await expect(new BackupLineageInventoryAdapter(source).inventory()).resolves.toMatchObject({
      state: "unavailable",
    });
  });

  it("returns stale/incomplete when a source is not current", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("replica", [
      { artifacts: [], nextToken: null, source: "replica", sourceCurrent: false },
    ]);
    await expect(new BackupLineageInventoryAdapter(source).inventory()).resolves.toMatchObject({
      state: "stale_incomplete",
    });
  });

  it("consumes every page before declaring inventory complete", async () => {
    const source = new ContractBackupLineageSource();
    source.setPagesForTest("pgbackrest_full_backup", [
      {
        artifacts: [artifact("pgbackrest_full_backup")],
        nextToken: "1",
        source: "pgbackrest_full_backup",
        sourceCurrent: true,
      },
      {
        artifacts: [artifact("pgbackrest_full_backup", "expired")],
        nextToken: null,
        source: "pgbackrest_full_backup",
        sourceCurrent: true,
      },
    ]);
    const result = await new BackupLineageInventoryAdapter(source).inventory();
    expect(result.state).toBe("complete_current");
    expect(
      result.artifacts.filter((item) => item.artifactClass === "pgbackrest_full_backup"),
    ).toHaveLength(2);
  });
});
