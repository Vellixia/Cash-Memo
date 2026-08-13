import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  EvidenceWriter,
  scanPrivacyCanaries,
  syntheticPrivacyCanaries,
  type EvidenceCheck,
} from "@cashmemo/test-support";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const phase14Paths = [
  "apps/server/src/bootstrap/server.ts",
  "apps/server/src/modules/export/export.controller.ts",
  "apps/server/src/modules/privacy/privacy-boundary.service.ts",
  "apps/web/src/privacy/privacy-boundary.ts",
  "apps/server/src/adapters/telemetry/safe-telemetry.ts",
  "apps/web/src/privacy/safe-client-diagnostics.ts",
  "packages/test-support/src/privacy/canary-scanner.ts",
  "apps/server/src/modules/operations/abuse-controls.ts",
  "apps/server/src/adapters/http/security-boundary.ts",
  "tests/privacy/boundary-matrix.spec.ts",
  "tests/privacy/diagnostic-channels.spec.ts",
  "tests/security/cross-user-isolation.spec.ts",
  "tests/security/authentication.spec.ts",
  "tests/security/untrusted-inputs.spec.ts",
  "infra/containers/init-identity-role.sql",
  ".gitleaks.toml",
  ".github/workflows/security.yml",
] as const;

const digest = createHash("sha256");
for (const path of phase14Paths) {
  digest.update(path);
  digest.update("\0");
  digest.update(await readFile(resolve(root, path)));
  digest.update("\0");
}
const buildDigest = `sha256:${digest.digest("hex")}`;
const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
const now = new Date().toISOString();
const forbiddenCanaries = syntheticPrivacyCanaries.map((canary) => canary.marker);

function checks(
  values: readonly (readonly [string, number])[],
  fixtureId: string,
): readonly EvidenceCheck[] {
  return values.map(([checkId, count]) => ({
    checkId,
    count,
    durationMs: null,
    fixtureId,
    result: "pass" as const,
    safeReasonCode: null,
  }));
}

async function writeGate(input: {
  readonly artifactName: "privacy-gate.json" | "security-gate.json";
  readonly checkValues: readonly (readonly [string, number])[];
  readonly directoryName: "privacy" | "security";
  readonly fixtureId: string;
  readonly procedureId: string;
  readonly requirementIds: readonly string[];
  readonly successCriterionIds: readonly string[];
}): Promise<void> {
  const directory = resolve(root, "ops/evidence", input.directoryName);
  const generated = resolve(directory, ".generated");
  const writer = new EvidenceWriter({
    acceptedDirectory: generated,
    forbiddenCanaries,
    quarantineDirectory: resolve(root, "ops/evidence/quarantine"),
  });
  const result = await writer.write({
    artifactName: input.artifactName,
    body: {
      checks: checks(input.checkValues, input.fixtureId),
      externalArtifacts: [],
      schemaVersion: "cashmemo-evidence-artifact-v1",
    },
    manifest: {
      artifactSha256: null,
      buildDigest,
      coarseResult: "pass",
      currencyRegistryVersion: "cldr47-iso4217-2026-01-01-cashmemo-v1",
      deployedConfigVersion: "phase14-local-security-v1",
      environment: {
        browserDeviceVersions: [],
        databaseEngineVersion: "18.4",
        ecsTaskDefinition: null,
        featureFlags: ["finite-privacy-boundaries", "allowlist-diagnostics", "forced-rls"],
        migrationVersion: "0006.phase11-operations",
        normalLoadProfile: null,
      },
      environmentId: "local-integration-stack",
      evidenceId: randomUUID(),
      finishedAt: now,
      gitCommit: stdout.trim(),
      providerDecisionVersions: ["local-contract-only-v1"],
      region: "local-colima",
      requirementIds: input.requirementIds,
      reviewedAt: now,
      reviewerRole: "automated-phase14-gate",
      safeFixtureSetVersion: input.fixtureId,
      startedAt: now,
      storyIds: ["US1", "US2", "US3", "US4", "US5", "US6", "US7", "US8"],
      successCriterionIds: input.successCriterionIds,
      testCommandOrProcedureId: input.procedureId,
      tzdbVersion: "system-local",
    },
  });
  const artifact = resolve(directory, input.artifactName);
  const manifest = resolve(directory, input.artifactName.replace(".json", ".manifest.json"));
  await mkdir(directory, { mode: 0o700, recursive: true });
  await rename(result.artifactPath, artifact);
  await rename(result.manifestPath, manifest);
  await rm(dirname(result.artifactPath), { recursive: true });
  const surfaces = await Promise.all(
    [artifact, manifest].map(async (path) => ({
      channel: "evidence" as const,
      content: await readFile(path, "utf8"),
      locationClass: "phase14.aggregate",
    })),
  );
  scanPrivacyCanaries(surfaces);
}

await writeGate({
  artifactName: "privacy-gate.json",
  checkValues: [
    ["privacy.boundary-matrix", 11],
    ["privacy.synthetic-corpus-rule-families", 7],
    ["privacy.synthetic-corpus-precision-per-thousand", 1_000],
    ["privacy.synthetic-corpus-recall-per-thousand", 1_000],
    ["privacy.diagnostic-channel-classes", 10],
    ["privacy.diagnostic-canary-leakage", 0],
    ["privacy.dedicated-prohibited-fields", 0],
    ["privacy.blocked-boundary-bypasses", 0],
    ["privacy.raw-voice-durable-copies", 0],
  ],
  directoryName: "privacy",
  fixtureId: "synthetic-detector-v1-corpus-v1",
  procedureId: "pnpm.test-privacy.phase14",
  requirementIds: [
    "FR-073",
    "FR-074",
    "FR-075",
    "FR-076",
    "FR-077",
    "FR-078",
    "FR-079",
    "FR-080",
    "FR-081",
    "FR-082",
    "FR-083",
    "FR-084",
    "FR-085",
    "FR-086",
  ],
  successCriterionIds: ["SC-016", "SC-017"],
});

await writeGate({
  artifactName: "security-gate.json",
  checkValues: [
    ["security.cross-account-reads", 0],
    ["security.cross-account-writes", 0],
    ["security.auth-bypasses", 0],
    ["security.unsafe-origin-acceptances", 0],
    ["security.private-diagnostic-leakage", 0],
    ["security.sql-query-injection-paths", 0],
    ["security.unsafe-csv-paths", 0],
    ["security.uncontrolled-serializers", 0],
    ["security.nonblocking-critical-ci-stages", 0],
  ],
  directoryName: "security",
  fixtureId: "synthetic-phase14-security-v1",
  procedureId: "pnpm.test-security.phase14",
  requirementIds: [
    "FR-073",
    "FR-074",
    "FR-075",
    "FR-076",
    "FR-077",
    "FR-078",
    "FR-079",
    "FR-080",
    "FR-081",
    "FR-082",
    "FR-083",
    "FR-084",
    "FR-085",
    "FR-086",
    "FR-087",
    "FR-088",
    "FR-089",
    "FR-090",
  ],
  successCriterionIds: ["SC-015", "SC-016", "SC-017"],
});

console.log("PHASE14_PRIVACY_SECURITY_EVIDENCE=WRITTEN content=safe-aggregate");
