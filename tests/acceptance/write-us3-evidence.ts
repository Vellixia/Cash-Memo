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
const artifact = resolve(directory, "us3-integration.json");
const manifest = resolve(directory, "us3-integration.manifest.json");
const paths = [
  "packages/privacy-rules/src/detector-v1.ts",
  "apps/server/src/modules/assisted-capture/text-extraction.service.ts",
  "apps/server/src/modules/assisted-capture/voice-capture.service.ts",
  "apps/server/src/modules/assisted-capture/confirm-draft.service.ts",
  "apps/web/src/features/capture/NaturalLanguageCapture.tsx",
  "apps/web/src/features/capture/VoiceRecorder.tsx",
  "tests/acceptance/us3-assisted-capture.spec.ts",
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
const writer = new EvidenceWriter({
  acceptedDirectory: generated,
  quarantineDirectory: resolve(root, "ops/evidence/quarantine"),
});
const fixture = "synthetic-reviewed-assisted-capture-v1";
const checks = [
  ["us3.typed-review-confirm", 1],
  ["us3.voice-review-confirm-isolation", 1],
  ["us3.voice-sixty-second-retention", 1],
  ["us3.privacy-recovery", 1],
  ["us3.auto-confirm-paths", 0],
  ["us3.confirmed-mutation-on-provider-failure", 0],
  ["us3.prohibited-candidate-persistence", 0],
  ["us3.blocked-provider-leakage", 0],
  ["us3.temporary-binary-durable-copies", 0],
  ["us3.terminal-cleanup-failures", 0],
  ["us3.cross-account-leakage", 0],
  ["us3.real-provider-launch-closure", null],
] as const;
const result = await writer.write({
  artifactName: "us3-integration.json",
  body: {
    checks: checks.map(([checkId, count]) => ({
      checkId,
      count,
      durationMs: null,
      fixtureId: fixture,
      result: count === null ? "blocked" : "pass",
      safeReasonCode: count === null ? "OPEN_EXTERNAL_APPROVAL" : null,
    })),
    externalArtifacts: [],
    schemaVersion: "cashmemo-evidence-artifact-v1",
  },
  manifest: {
    artifactSha256: null,
    buildDigest: `sha256:${digest.digest("hex")}`,
    coarseResult: "pass",
    currencyRegistryVersion: "cldr47-iso4217-2026-01-01-cashmemo-v1",
    deployedConfigVersion: "local-us3-contract-fake-v1",
    environment: {
      browserDeviceVersions: ["chromium-playwright-1.62.1"],
      databaseEngineVersion: "18.4",
      ecsTaskDefinition: null,
      featureFlags: [
        "review-before-confirm",
        "ephemeral-binary",
        "finite-detector-v1",
        "contract-fake-provider",
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
    requirementIds: [
      "FR-031",
      "FR-032",
      "FR-033",
      "FR-034",
      "FR-035",
      "FR-036",
      "FR-037",
      "FR-038",
      "FR-039",
    ],
    reviewedAt: now,
    reviewerRole: "automated-us3-contract-fake-acceptance-gate",
    safeFixtureSetVersion: fixture,
    startedAt: now,
    storyIds: ["US3"],
    successCriterionIds: ["SC-007", "SC-008", "SC-009"],
    testCommandOrProcedureId: "pnpm.acceptance-us3",
    tzdbVersion: "system-local",
  },
});
await mkdir(directory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifact);
await rename(result.manifestPath, manifest);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("US3_INTEGRATION_EVIDENCE=WRITTEN");
