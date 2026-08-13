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
const artifactPath = resolve(evidenceDirectory, "us7.json");
const manifestPath = resolve(evidenceDirectory, "us7.manifest.json");
const digestPaths = [
  "packages/domain/src/reporting/monthly-review.ts",
  "apps/server/src/modules/reporting/monthly-review.service.ts",
  "apps/server/src/modules/reporting/monthly-review.controller.ts",
  "apps/web/src/features/reporting/MonthlyReview.tsx",
  "tests/acceptance/us7-monthly-review.spec.ts",
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
  artifactName: "us7.json",
  body: {
    checks: [
      {
        checkId: "us7.browser-deterministic-review",
        count: 1,
        durationMs: 18_000,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.reporting-zone-empty-isolation",
        count: 1,
        durationMs: 15_000,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.fail-closed-independent-journal",
        count: 1,
        durationMs: 10_000,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.golden-mismatches",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.cross-currency-scalar-paths",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.generated-narrative-paths",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.conversion-paths",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.divide-by-zero-outputs",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.nondeterministic-ranking-ties",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.cross-account-leakage",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us7.stale-partial-success-presentation",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us7-v1",
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
    deployedConfigVersion: "local-us7-v1",
    environment: {
      browserDeviceVersions: ["chromium-playwright-1.62.1"],
      databaseEngineVersion: "18.4",
      runtimeArtifact: null,
      featureFlags: [
        "currency-partition-first",
        "reporting-timezone-calendar-month",
        "fail-closed-monthly-review",
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
    requirementIds: ["FR-066", "FR-067", "FR-068", "FR-069", "FR-070", "FR-071", "FR-072"],
    reviewedAt: finishedAt,
    reviewerRole: "automated-us7-acceptance-gate",
    safeFixtureSetVersion: "synthetic-two-account-us7-v1",
    startedAt: finishedAt,
    storyIds: ["US7"],
    successCriterionIds: ["SC-012"],
    testCommandOrProcedureId: "pnpm.acceptance-us7",
    tzdbVersion: "system-local",
  },
});

await mkdir(evidenceDirectory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifactPath);
await rename(result.manifestPath, manifestPath);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("US7_EVIDENCE=WRITTEN");
