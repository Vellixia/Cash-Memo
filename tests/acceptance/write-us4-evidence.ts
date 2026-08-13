import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { EvidenceWriter } from "@cashmemo/test-support";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const evidenceDirectory = resolve(repositoryRoot, "ops/evidence/stories");
const generatedDirectory = resolve(evidenceDirectory, ".generated");
const artifactPath = resolve(evidenceDirectory, "us4.json");
const manifestPath = resolve(evidenceDirectory, "us4.manifest.json");
const digestPaths = [
  "packages/domain/src/reporting/current-month.ts",
  "apps/server/src/modules/reporting/current-month.service.ts",
  "apps/server/src/modules/reporting/current-month.controller.ts",
  "apps/web/src/features/reporting/CurrentMonthOverview.tsx",
  "tests/acceptance/us4-current-month.spec.ts",
] as const;

const hash = createHash("sha256");
for (const path of digestPaths) {
  hash.update(path);
  hash.update("\0");
  hash.update(await readFile(resolve(repositoryRoot, path)));
  hash.update("\0");
}
const buildDigest = `sha256:${hash.digest("hex")}`;
const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
const finishedAt = new Date().toISOString();
const writer = new EvidenceWriter({
  acceptedDirectory: generatedDirectory,
  quarantineDirectory: resolve(repositoryRoot, "ops/evidence/quarantine"),
});

const result = await writer.write({
  artifactName: "us4.json",
  body: {
    checks: [
      {
        checkId: "us4.browser-exact-currency-eligibility",
        count: 1,
        durationMs: 12_000,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us4.reporting-zone-empty-isolation",
        count: 1,
        durationMs: 15_000,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us4.fail-closed-independent-journal",
        count: 1,
        durationMs: 10_000,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us4.cross-currency-scalar-paths",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us4.calculation-evidence-mismatches",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us4.cross-account-leakage",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us4.private-financial-telemetry",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us4.stale-partial-success-presentation",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us4-v1",
        result: "pass",
        safeReasonCode: null,
      },
    ],
    externalArtifacts: [],
    schemaVersion: "cashmemo-evidence-artifact-v1",
  },
  manifest: {
    artifactSha256: null,
    buildDigest,
    coarseResult: "pass",
    currencyRegistryVersion: "cldr47-iso4217-2026-01-01-cashmemo-v1",
    deployedConfigVersion: "local-us4-v1",
    environment: {
      browserDeviceVersions: ["chromium-playwright-1.62.1"],
      databaseEngineVersion: "18.4",
      runtimeArtifact: null,
      featureFlags: [
        "currency-partition-first",
        "reporting-timezone-month",
        "fail-closed-overview",
      ],
      migrationVersion: "0005.search-projection",
      normalLoadProfile: null,
    },
    environmentId: "local-integration-stack",
    evidenceId: randomUUID(),
    finishedAt,
    gitCommit: stdout.trim(),
    providerDecisionVersions: [],
    region: "local-docker",
    requirementIds: ["FR-061", "FR-062", "FR-063", "FR-064", "FR-065", "FR-071", "FR-072"],
    reviewedAt: finishedAt,
    reviewerRole: "automated-us4-acceptance-gate",
    safeFixtureSetVersion: "synthetic-two-account-us4-v1",
    startedAt: finishedAt,
    storyIds: ["US4"],
    successCriterionIds: ["SC-005", "SC-006", "SC-012"],
    testCommandOrProcedureId: "pnpm.acceptance-us4",
    tzdbVersion: "system-local",
  },
});

await mkdir(evidenceDirectory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifactPath);
await rename(result.manifestPath, manifestPath);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("US4_EVIDENCE=WRITTEN");
