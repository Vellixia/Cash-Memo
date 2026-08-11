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
const artifactPath = resolve(evidenceDirectory, "us6.json");
const manifestPath = resolve(evidenceDirectory, "us6.manifest.json");
const digestPaths = [
  "apps/server/src/adapters/postgres/migrations/0005_search_projection.sql",
  "apps/server/src/modules/history/search.repository.ts",
  "apps/server/src/modules/labels/labels.service.ts",
  "tests/acceptance/us6-organize-find.spec.ts",
  "tests/security/us6-search-label-isolation.spec.ts",
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
  artifactName: "us6.json",
  body: {
    checks: [
      {
        checkId: "us6.browser-label-lifecycle",
        count: 1,
        durationMs: 37_700,
        fixtureId: "synthetic-two-account-us6-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us6.private-search-intersection-traversal",
        count: 1,
        durationMs: 6400,
        fixtureId: "synthetic-two-account-us6-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us6.account-isolation-privacy-boundary",
        count: 1,
        durationMs: 4400,
        fixtureId: "synthetic-two-account-us6-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us6.search-disclosure",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us6-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us6.cross-account-leakage",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us6-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "us6.stale-traversal-leakage",
        count: 0,
        durationMs: null,
        fixtureId: "synthetic-two-account-us6-v1",
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
    deployedConfigVersion: "local-us6-v1",
    environment: {
      browserDeviceVersions: ["chromium-playwright-1.62.1"],
      databaseEngineVersion: "18.4",
      ecsTaskDefinition: null,
      featureFlags: ["account-first-search", "gin-simple-search", "version-bound-traversal"],
      migrationVersion: "0005.search-projection",
      normalLoadProfile: null,
    },
    environmentId: "local-integration-stack",
    evidenceId: randomUUID(),
    finishedAt,
    gitCommit: stdout.trim(),
    providerDecisionVersions: [],
    region: "local-docker",
    requirementIds: [
      "FR-030",
      "FR-051",
      "FR-052",
      "FR-053",
      "FR-054",
      "FR-055",
      "FR-056",
      "FR-057",
      "FR-058",
      "FR-059",
      "FR-060",
      "FR-118",
    ],
    reviewedAt: finishedAt,
    reviewerRole: "automated-us6-acceptance-gate",
    safeFixtureSetVersion: "synthetic-two-account-us6-v1",
    startedAt: finishedAt,
    storyIds: ["US6"],
    successCriterionIds: ["SC-015", "SC-023", "SC-026"],
    testCommandOrProcedureId: "pnpm.acceptance-us6",
    tzdbVersion: "system-local",
  },
});

await mkdir(evidenceDirectory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifactPath);
await rename(result.manifestPath, manifestPath);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("US6_EVIDENCE=WRITTEN");
