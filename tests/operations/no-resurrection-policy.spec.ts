import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const POLICY = new URL("../../infra/dokploy/policies/backup-copy-policy.json", import.meta.url);

describe("no-resurrection-copies policy as code", () => {
  it("owns every prohibited or tracked resurrection-capable artifact class", async () => {
    const source = await readFile(POLICY, "utf8");
    for (const artifactClass of [
      "pgbackrest_full_backup",
      "pgbackrest_differential_backup",
      "pgbackrest_incremental_backup",
      "wal_archive",
      "local_repository",
      "secondary_object_version",
      "manual_operator_copy",
      "volume_snapshot",
      "replica",
      "temporary_restore_copy",
    ]) {
      expect(source).toContain(`"${artifactClass}"`);
    }
  });

  it("denies unregistered copies and requires an independent production failure domain", async () => {
    const source = await readFile(POLICY, "utf8");
    expect(source).toContain('"unregisteredCopyAllowed": false');
    expect(source).toContain('"productionIndependentFailureDomainRequired": true');
    expect(source).toContain('"inventoryFailureDecision": "retain_suppression_alert_retry"');
    expect(source).toContain('"timeOnlyCleanupAllowed": false');
  });
});
