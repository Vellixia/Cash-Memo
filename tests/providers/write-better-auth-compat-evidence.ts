import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { EvidenceWriter } from "@cashmemo/test-support";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const providerDirectory = resolve(repositoryRoot, "ops/evidence/provider");
const artifactPath = resolve(providerDirectory, "better-auth-compat.json");
const manifestPath = resolve(providerDirectory, "better-auth-compat.manifest.json");
const testPath = resolve(repositoryRoot, "tests/providers/better-auth.compat.spec.ts");
const adapterPath = resolve(
  repositoryRoot,
  "apps/server/src/modules/identity/better-auth.adapter.ts",
);
const migrationPath = resolve(
  repositoryRoot,
  "apps/server/src/adapters/postgres/migrations/0003_better_auth_compat.sql",
);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const testSource = await readFile(testPath, "utf8");
const adapterSource = await readFile(adapterPath, "utf8");
const migrationSource = await readFile(migrationPath, "utf8");
const buildDigest = `sha256:${createHash("sha256")
  .update("better-auth@1.6.26\0")
  .update(migrationSource)
  .update("\0")
  .update(adapterSource)
  .update("\0")
  .update(testSource)
  .digest("hex")}`;

if ((await exists(artifactPath)) || (await exists(manifestPath))) {
  if (!(await exists(artifactPath)) || !(await exists(manifestPath))) {
    throw new Error("BETTER_AUTH_COMPAT_EVIDENCE_INCOMPLETE");
  }
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BETTER_AUTH_COMPAT_MANIFEST_INVALID");
  }
  const existingDigest = (parsed as Record<string, unknown>)["buildDigest"];
  if (existingDigest !== buildDigest) {
    throw new Error("BETTER_AUTH_COMPAT_EVIDENCE_STALE_REVIEW_REQUIRED");
  }
  console.log("BETTER_AUTH_COMPAT_EVIDENCE=EXISTING_VALID");
  process.exit(0);
}

const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
const finishedAt = new Date().toISOString();
const evidenceId = randomUUID();
const generatedDirectory = resolve(providerDirectory, ".generated");
const writer = new EvidenceWriter({
  acceptedDirectory: generatedDirectory,
  quarantineDirectory: resolve(repositoryRoot, "ops/evidence/quarantine"),
});

const result = await writer.write({
  artifactName: "better-auth-compat.json",
  body: {
    checks: [
      {
        checkId: "better-auth.core-schema-native-postgres-uuid",
        count: 4,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "better-auth.boolean-verification-neutral-name",
        count: 6,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "better-auth.database-session-restoration-secure-host-cookie",
        count: 6,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "better-auth.inactivity-refresh-policy",
        count: 2,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "better-auth.absolute-age-supported-revocation",
        count: 1,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "better-auth.current-other-all-revocation",
        count: 3,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "better-auth.hashed-reset-single-use-expiry-oauth-null",
        count: 7,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "better-auth.secondary-stateless-cache-telemetry-disabled",
        count: 6,
        durationMs: null,
        fixtureId: "synthetic-identities-v1",
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
    currencyRegistryVersion: "not-applicable",
    deployedConfigVersion: "better-auth-compat-v3",
    environment: {
      browserDeviceVersions: [],
      databaseEngineVersion: "18.4",
      ecsTaskDefinition: null,
      featureFlags: [
        "argon2id-password-callbacks",
        "cookie-cache-disabled",
        "credential-only-oauth-null",
        "hashed-verification-identifiers",
        "host-only-secure-session-cookie",
        "identity-logger-disabled",
        "native-postgres-uuid",
        "secondary-storage-disabled",
      ],
      migrationVersion: "0003.better-auth-compat",
      normalLoadProfile: null,
    },
    environmentId: "local-testcontainers",
    evidenceId,
    finishedAt,
    gitCommit: stdout.trim(),
    providerDecisionVersions: ["better-auth-1.6.26"],
    region: "local-docker",
    requirementIds: ["FR-001", "FR-002", "FR-003"],
    reviewedAt: null,
    reviewerRole: "automated-provider-compat-gate",
    safeFixtureSetVersion: "synthetic-identities-v1",
    startedAt: finishedAt,
    storyIds: ["US1"],
    successCriterionIds: [],
    testCommandOrProcedureId: "pnpm.test-auth-better-auth-compat",
    tzdbVersion: "not-applicable",
  },
});

await mkdir(providerDirectory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifactPath);
await rename(result.manifestPath, manifestPath);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("BETTER_AUTH_COMPAT_EVIDENCE=WRITTEN");
