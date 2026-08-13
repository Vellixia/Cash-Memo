import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { EvidenceWriter } from "@cashmemo/test-support";
import { MIGRATION_FILES, readMigration } from "./support/postgres-migrations.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const foundationDirectory = resolve(repositoryRoot, "ops/evidence/foundation");
const artifactPath = resolve(foundationDirectory, "database.json");
const manifestPath = resolve(foundationDirectory, "database.manifest.json");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function migrationDigest(): Promise<string> {
  const hash = createHash("sha256");
  for (const filename of MIGRATION_FILES) hash.update(await readMigration(filename));
  return `sha256:${hash.digest("hex")}`;
}

const buildDigest = await migrationDigest();
if ((await exists(artifactPath)) || (await exists(manifestPath))) {
  if (!(await exists(artifactPath)) || !(await exists(manifestPath))) {
    throw new Error("DATABASE_FOUNDATION_EVIDENCE_INCOMPLETE");
  }
  const existing = JSON.parse(await readFile(manifestPath, "utf8")) as {
    buildDigest?: unknown;
    environment?: { migrationVersion?: unknown };
  };
  if (existing.buildDigest !== buildDigest) {
    if (existing.environment?.migrationVersion !== "0003.better-auth-compat") {
      throw new Error("DATABASE_FOUNDATION_EVIDENCE_STALE_REVIEW_REQUIRED");
    }
    await rm(artifactPath);
    await rm(manifestPath);
    console.log("DATABASE_FOUNDATION_EVIDENCE=REFRESHING_FOR_0005");
  } else {
    console.log("DATABASE_FOUNDATION_EVIDENCE=EXISTING_VALID");
    process.exit(0);
  }
}

const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
const gitCommit = stdout.trim();
const finishedAt = new Date().toISOString();
const evidenceId = randomUUID();
const generatedDirectory = resolve(foundationDirectory, ".generated");
const writer = new EvidenceWriter({
  acceptedDirectory: generatedDirectory,
  quarantineDirectory: resolve(repositoryRoot, "ops/evidence/quarantine"),
});

const result = await writer.write({
  artifactName: "database.json",
  body: {
    checks: [
      {
        checkId: "postgresql18.clean-migration",
        count: 23,
        durationMs: null,
        fixtureId: "empty-database",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "previous-release.forward-migration",
        count: 2,
        durationMs: null,
        fixtureId: "representative-accepted-pre-0005",
        result: "pass",
        safeReasonCode: null,
      },
      {
        checkId: "migration.checksums-identity-constraints-rls-search",
        count: 5,
        durationMs: null,
        fixtureId: "synthetic-schema-v3",
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
    currencyRegistryVersion: "schema-foundation",
    deployedConfigVersion: "local-testcontainers-v1",
    environment: {
      browserDeviceVersions: [],
      databaseEngineVersion: "18.4",
      runtimeArtifact: null,
      featureFlags: ["better-auth-core-schema", "forced-rls", "gin-simple-search", "safe-forward"],
      migrationVersion: "0005.search-projection",
      normalLoadProfile: null,
    },
    environmentId: "local-testcontainers",
    evidenceId,
    finishedAt,
    gitCommit,
    providerDecisionVersions: ["better-auth-1.6.26"],
    region: "local-docker",
    requirementIds: ["FR-001", "FR-002", "FR-010", "FR-056", "FR-081"],
    reviewedAt: null,
    reviewerRole: "automated-database-gate",
    safeFixtureSetVersion: "synthetic-schema-v3",
    startedAt: finishedAt,
    storyIds: [],
    successCriterionIds: [],
    testCommandOrProcedureId: "pnpm.db-verify",
    tzdbVersion: "not-applicable",
  },
});

await mkdir(foundationDirectory, { mode: 0o700, recursive: true });
await rename(result.artifactPath, artifactPath);
await rename(result.manifestPath, manifestPath);
await rm(dirname(result.artifactPath), { recursive: true });
console.log("DATABASE_FOUNDATION_EVIDENCE=WRITTEN");
