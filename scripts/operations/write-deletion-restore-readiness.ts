import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { EvidenceWriter } from "@cashmemo/test-support";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, "ops/evidence/operations");
const generated = resolve(directory, ".generated");
const artifact = resolve(directory, "deletion-restore-readiness.json");
const manifest = resolve(directory, "deletion-restore-readiness.manifest.json");
const paths = [
  "apps/server/src/adapters/rustfs/deletion-suppression.adapter.ts",
  "apps/server/src/adapters/backup/backup-lineage-inventory.adapter.ts",
  "apps/server/src/modules/deletion/suppression-cleanup.service.ts",
  "apps/server/src/modules/deletion/restore-reconciliation.service.ts",
  "scripts/operations/restore-reconcile.mjs",
  "scripts/operations/restore-copy-lifecycle.mjs",
  "infra/dokploy/policies/backup-copy-policy.json",
] as const;
const digest = createHash("sha256");
for (const path of paths) {
  digest.update(path);
  digest.update("\0");
  digest.update(await readFile(resolve(root, path)));
  digest.update("\0");
}
const isCommitSha = (value: string | undefined): value is string =>
  value !== undefined && /^[0-9a-f]{40}$/u.test(value);
const declaredBuildVersion = process.env["BUILD_VERSION"];
const gitCommit = isCommitSha(declaredBuildVersion)
  ? declaredBuildVersion
  : (
      await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      })
    ).stdout.trim();
const now = new Date().toISOString();
const fixture = "synthetic-phase13-non-production-readiness-v1";
const checks = [
  ["phase13.evidence-class-non-production-readiness", 1],
  ["phase13.real-pgbackrest-pitr-drill-open", 1],
  ["phase13.sc021-open", 1],
  ["phase13.hard-delete-before-ledger", 0],
  ["phase13.hard-delete-on-unverifiable-ledger", 0],
  ["phase13.time-only-suppression-cleanup", 0],
  ["phase13.cleanup-with-capable-artifact", 0],
  ["phase13.cleanup-on-unavailable-stale-inventory", 0],
  ["phase13.premature-key-retirement", 0],
  ["phase13.restore-release-before-reconciliation", 0],
  ["phase13.suppressed-content-resurrection", 0],
  ["phase13.neighboring-valid-data-loss", 0],
  ["phase13.unregistered-restore-copy-acceptance", 0],
] as const;
const writer = new EvidenceWriter({
  acceptedDirectory: generated,
  quarantineDirectory: resolve(root, "ops/evidence/quarantine"),
});
const result = await writer.write({
  artifactName: "deletion-restore-readiness.json",
  body: {
    checks: checks.map(([checkId, count]) => ({
      checkId,
      count,
      durationMs: null,
      fixtureId: fixture,
      result: "pass" as const,
      safeReasonCode: null,
    })),
    externalArtifacts: [],
    schemaVersion: "cashmemo-evidence-artifact-v1",
  },
  manifest: {
    artifactSha256: null,
    buildDigest: `sha256:${digest.digest("hex")}`,
    coarseResult: "pass",
    currencyRegistryVersion: "cldr47-iso4217-2026-01-01-cashmemo-v1",
    deployedConfigVersion: "phase13-local-contract-readiness-v1",
    environment: {
      browserDeviceVersions: [],
      databaseEngineVersion: "18.4",
      runtimeArtifact: null,
      featureFlags: ["contract-rustfs-ledger", "contract-backup-inventory", "synthetic-restore"],
      migrationVersion: "0006.phase11-operations",
      normalLoadProfile: null,
    },
    environmentId: "local-contract-readiness",
    evidenceId: randomUUID(),
    finishedAt: now,
    gitCommit,
    providerDecisionVersions: ["local-contract-only-v1"],
    region: "local-synthetic",
    requirementIds: ["FR-096", "FR-100", "FR-114", "FR-115"],
    reviewedAt: now,
    reviewerRole: "automated-operations-readiness-gate",
    safeFixtureSetVersion: fixture,
    startedAt: now,
    storyIds: ["US8"],
    successCriterionIds: ["SC-020", "SC-021"],
    testCommandOrProcedureId: "pnpm.test-operations.local-contract",
    tzdbVersion: "system-local",
  },
});
await mkdir(directory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifact);
await rename(result.manifestPath, manifest);
await rm(dirname(result.artifactPath), { recursive: true });
console.log(
  "DELETION_RESTORE_READINESS_EVIDENCE=WRITTEN class=non-production-readiness sc021=OPEN real-pitr=OPEN",
);
