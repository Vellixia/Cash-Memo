import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const POLICY = new URL(
  "../../infra/opentofu/modules/data-safety/no-resurrection-copies.tf",
  import.meta.url,
);

describe("no-resurrection-copies policy as code", () => {
  it("owns every prohibited or tracked resurrection-capable artifact class", async () => {
    const source = await readFile(POLICY, "utf8");
    for (const artifactClass of [
      "manual_snapshot",
      "final_snapshot",
      "copied_snapshot",
      "shared_snapshot",
      "retained_automated_backup",
      "aws_backup_recovery_point",
      "cross_region_copy",
    ]) {
      expect(source).toContain(`"${artifactClass}"`);
    }
  });

  it("denies unregistered RDS and AWS Backup copies and makes drift release-blocking", async () => {
    const source = await readFile(POLICY, "utf8");
    expect(source).toContain('Effect = "Deny"');
    expect(source).toContain("cashmemo:lineage-registered");
    expect(source).toContain("cashmemo:release-blocking");
    expect(source).toContain("rds:ModifyDBSnapshotAttribute");
    expect(source).toContain("backup:StartCopyJob");
  });
});
