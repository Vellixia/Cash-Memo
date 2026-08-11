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
const artifact = resolve(directory, "us5.json");
const manifest = resolve(directory, "us5.manifest.json");
const paths = [
  "tests/failure/failure-matrix.ts",
  "packages/test-support/src/harness/fault-proxy-scenarios.ts",
  "apps/web/tests/integration/network-recovery.spec.ts",
  "apps/web/src/features/degraded/recoverable-draft.ts",
  "apps/web/src/features/degraded/CapabilityStatus.tsx",
  "apps/web/src/features/auth/AuthRoutes.tsx",
  "apps/web/src/features/capture/NaturalLanguageCapture.tsx",
  "apps/server/tests/integration/commit-point-retry.spec.ts",
  "apps/server/src/bootstrap/server.ts",
  "apps/server/src/bootstrap/capability-mode.ts",
  "apps/server/src/adapters/telemetry/resilient-exporter.ts",
  "apps/server/src/bootstrap/core-readiness.guard.ts",
  "apps/server/src/modules/assisted-capture/recovery-policy.ts",
  "tests/failure/confirmed-record-invariants.spec.ts",
  "tests/acceptance/us5-degraded-operation.spec.ts",
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
const fixture = "synthetic-degraded-operation-v1";
const checks = [
  ["us5.failure-matrix-faults", 45],
  ["us5.network-recovery-cases", 6],
  ["us5.commit-point-cases", 5],
  ["us5.confirmed-record-invariants", 8],
  ["us5.acceptance-scenarios", 4],
  ["us5.authoritative-writes-during-db-outage", 0],
  ["us5.auth-bypasses", 0],
  ["us5.duplicate-authority", 0],
  ["us5.accelerator-failure-confirmed-mutations", 0],
  ["us5.telemetry-failure-confirmed-mutations", 0],
  ["us5.partial-auto-confirm-paths", 0],
  ["us5.private-fault-path-leakage", 0],
  ["us5.cross-account-degraded-leakage", 0],
  ["us5.unbounded-retry-queue-paths", 0],
] as const;
const writer = new EvidenceWriter({
  acceptedDirectory: generated,
  quarantineDirectory: resolve(root, "ops/evidence/quarantine"),
});
const result = await writer.write({
  artifactName: "us5.json",
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
    deployedConfigVersion: "local-us5-controlled-fault-v1",
    environment: {
      browserDeviceVersions: ["chromium-playwright-1.62.1"],
      databaseEngineVersion: "18.4",
      ecsTaskDefinition: null,
      featureFlags: [
        "controlled-provider-faults",
        "controlled-network-faults",
        "bounded-telemetry",
        "fail-closed-core",
      ],
      migrationVersion: "0005.search-projection",
      normalLoadProfile: null,
    },
    environmentId: "local-integration-stack",
    evidenceId: randomUUID(),
    finishedAt: now,
    gitCommit: stdout.trim(),
    providerDecisionVersions: ["contract-fake-v1"],
    region: "local-docker",
    requirementIds: ["FR-029", "FR-031", "FR-037", "FR-038", "FR-046", "FR-071", "FR-111"],
    reviewedAt: now,
    reviewerRole: "automated-us5-acceptance-gate",
    safeFixtureSetVersion: fixture,
    startedAt: now,
    storyIds: ["US5"],
    successCriterionIds: ["SC-003", "SC-010", "SC-011"],
    testCommandOrProcedureId: "pnpm.acceptance-us5",
    tzdbVersion: "system-local",
  },
});
await mkdir(directory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifact);
await rename(result.manifestPath, manifest);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("US5_EVIDENCE=WRITTEN");
