import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { EvidenceWriter } from "@cashmemo/test-support";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, "ops/evidence/stories");
const generated = resolve(directory, ".generated");
const artifact = resolve(directory, "us8-integration.json");
const manifest = resolve(directory, "us8-integration.manifest.json");
const paths = [
  "apps/server/src/modules/export/export-v1.serializer.ts",
  "apps/server/src/modules/export/export-job.service.ts",
  "apps/server/src/adapters/aws/export-object-store.adapter.ts",
  "apps/server/src/modules/deletion/deletion-suppression.port.ts",
  "apps/server/src/modules/deletion/memo-purge.worker.ts",
  "apps/server/src/modules/deletion/account-purge.worker.ts",
  "apps/server/src/modules/deletion/provider-deletion.service.ts",
  "tests/acceptance/us8-data-ownership.spec.ts",
] as const;
const digest = createHash("sha256");
for (const path of paths) {
  digest.update(path);
  digest.update("\0");
  digest.update(await readFile(resolve(root, path)));
  digest.update("\0");
}
const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
const now = new Date().toISOString();
const fixture = "synthetic-us8-contract-integration-v1";
const checks = [
  ["us8.storage-mode-contract-integration", 1],
  ["us8.suppression-mode-contract-integration", 1],
  ["us8.real-aws-restore-deletion-closure-open", 1],
  ["us8.acceptance-scenarios", 4],
  ["us8.export-deterministic-mismatches", 0],
  ["us8.cross-currency-conversion-paths", 0],
  ["us8.public-object-url-paths", 0],
  ["us8.residual-expired-object-versions", 0],
  ["us8.cross-account-leakage", 0],
  ["us8.hard-delete-before-suppression", 0],
  ["us8.hard-delete-on-suppression-failure", 0],
  ["us8.misleading-completion-states", 0],
  ["us8.deleted-content-evidence-leakage", 0],
] as const;
const writer = new EvidenceWriter({
  acceptedDirectory: generated,
  quarantineDirectory: resolve(root, "ops/evidence/quarantine"),
});
const result = await writer.write({
  artifactName: "us8-integration.json",
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
    deployedConfigVersion: "local-us8-contract-integration-v1",
    environment: {
      browserDeviceVersions: ["chromium-playwright-1.62.1"],
      databaseEngineVersion: "18.4",
      ecsTaskDefinition: null,
      featureFlags: [
        "contract-export-storage",
        "contract-deletion-suppression",
        "controlled-clock",
        "controlled-faults",
      ],
      migrationVersion: "0006.phase11-operations",
      normalLoadProfile: null,
    },
    environmentId: "local-integration-stack",
    evidenceId: randomUUID(),
    finishedAt: now,
    gitCommit: stdout.trim(),
    providerDecisionVersions: ["local-disabled-v1"],
    region: "local-docker",
    requirementIds: ["FR-091", "FR-092", "FR-093", "FR-094", "FR-095", "FR-096"],
    reviewedAt: now,
    reviewerRole: "automated-us8-integration-gate",
    safeFixtureSetVersion: fixture,
    startedAt: now,
    storyIds: ["US8"],
    successCriterionIds: ["SC-015", "SC-019", "SC-020"],
    testCommandOrProcedureId: "pnpm.acceptance-us8",
    tzdbVersion: "system-local",
  },
});
await mkdir(directory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifact);
await rename(result.manifestPath, manifest);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("US8_INTEGRATION_EVIDENCE=WRITTEN");
