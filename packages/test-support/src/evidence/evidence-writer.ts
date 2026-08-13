import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BUILD_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;
const ARTIFACT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}\.json$/u;

const bodyKeys = new Set(["checks", "externalArtifacts", "schemaVersion"]);
const checkKeys = new Set([
  "checkId",
  "count",
  "durationMs",
  "fixtureId",
  "result",
  "safeReasonCode",
]);
const externalArtifactKeys = new Set(["artifactId", "sha256"]);
const manifestKeys = new Set([
  "artifactSha256",
  "buildDigest",
  "coarseResult",
  "currencyRegistryVersion",
  "deployedConfigVersion",
  "environment",
  "environmentId",
  "evidenceId",
  "finishedAt",
  "gitCommit",
  "providerDecisionVersions",
  "region",
  "requirementIds",
  "reviewedAt",
  "reviewerRole",
  "safeFixtureSetVersion",
  "startedAt",
  "storyIds",
  "successCriterionIds",
  "testCommandOrProcedureId",
  "tzdbVersion",
]);
const environmentKeys = new Set([
  "browserDeviceVersions",
  "databaseEngineVersion",
  "runtimeArtifact",
  "featureFlags",
  "migrationVersion",
  "normalLoadProfile",
]);
const legacyEnvironmentKeys = new Set([
  "browserDeviceVersions",
  "databaseEngineVersion",
  "ecsTaskDefinition",
  "featureFlags",
  "migrationVersion",
  "normalLoadProfile",
]);

export type EvidenceCheckResult = "pass" | "fail" | "blocked" | "not_applicable";
export type EvidenceCoarseResult = "pass" | "fail" | "blocked";

export interface EvidenceCheck {
  readonly checkId: string;
  readonly count: number | null;
  readonly durationMs: number | null;
  readonly fixtureId: string | null;
  readonly result: EvidenceCheckResult;
  readonly safeReasonCode: string | null;
}

export interface ProtectedExternalArtifact {
  readonly artifactId: string;
  readonly sha256: string;
}

export interface EvidenceArtifactBody {
  readonly checks: readonly EvidenceCheck[];
  readonly externalArtifacts: readonly ProtectedExternalArtifact[];
  readonly schemaVersion: "cashmemo-evidence-artifact-v1";
}

export interface EvidenceEnvironment {
  readonly browserDeviceVersions: readonly string[];
  readonly databaseEngineVersion: string;
  readonly runtimeArtifact: string | null;
  readonly featureFlags: readonly string[];
  readonly migrationVersion: string;
  readonly normalLoadProfile: string | null;
}

export interface EvidenceManifestInput {
  readonly artifactSha256: null;
  readonly buildDigest: string;
  readonly coarseResult: EvidenceCoarseResult;
  readonly currencyRegistryVersion: string;
  readonly deployedConfigVersion: string;
  readonly environment: EvidenceEnvironment;
  readonly environmentId: string;
  readonly evidenceId: string;
  readonly finishedAt: string;
  readonly gitCommit: string;
  readonly providerDecisionVersions: readonly string[];
  readonly region: string;
  readonly requirementIds: readonly string[];
  readonly reviewedAt: string | null;
  readonly reviewerRole: string;
  readonly safeFixtureSetVersion: string;
  readonly startedAt: string;
  readonly storyIds: readonly string[];
  readonly successCriterionIds: readonly string[];
  readonly testCommandOrProcedureId: string;
  readonly tzdbVersion: string;
}

export interface EvidenceManifest extends Omit<EvidenceManifestInput, "artifactSha256"> {
  readonly artifactSha256: string;
  readonly schemaVersion: "cashmemo-evidence-manifest-v1";
}

export interface EvidenceRecordInput {
  readonly artifactName: string;
  readonly body: EvidenceArtifactBody;
  readonly manifest: EvidenceManifestInput;
}

export interface EvidenceWriteResult {
  readonly artifactPath: string;
  readonly manifest: EvidenceManifest;
  readonly manifestPath: string;
}

export interface EvidenceWriterOptions {
  readonly acceptedDirectory: string;
  readonly forbiddenCanaries?: readonly string[];
  readonly now?: () => Date;
  readonly quarantineDirectory: string;
}

type EvidenceRejectionReason =
  | "artifact_name_invalid"
  | "schema_invalid"
  | "seeded_canary"
  | "email_like_content"
  | "credential_like_content"
  | "query_url"
  | "money_like_content"
  | "forbidden_content_field";

export class EvidenceRejectedError extends Error {
  constructor(readonly reasons: readonly EvidenceRejectionReason[]) {
    super(`Evidence rejected: ${reasons.join(",")}`);
    this.name = "EvidenceRejectedError";
  }
}

function isPlainExactObject(value: unknown, allowed: ReadonlySet<string>): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === "string" && allowed.has(key)) &&
    Object.keys(value).length === keys.length
  );
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

function isSafeIntegerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isUniqueSafeIdArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every(isSafeId) && new Set<string>(value).size === value.length
  );
}

function validateBody(value: unknown): value is EvidenceArtifactBody {
  if (!isPlainExactObject(value, bodyKeys)) return false;
  const body = value as Record<string, unknown>;
  if (body["schemaVersion"] !== "cashmemo-evidence-artifact-v1") return false;
  if (!Array.isArray(body["checks"]) || !Array.isArray(body["externalArtifacts"])) return false;
  const checksValid = body["checks"].every((candidate: unknown) => {
    if (!isPlainExactObject(candidate, checkKeys)) return false;
    const check = candidate as Record<string, unknown>;
    return (
      isSafeId(check["checkId"]) &&
      isSafeIntegerOrNull(check["count"]) &&
      isSafeIntegerOrNull(check["durationMs"]) &&
      (check["fixtureId"] === null || isSafeId(check["fixtureId"])) &&
      ["pass", "fail", "blocked", "not_applicable"].includes(String(check["result"])) &&
      (check["safeReasonCode"] === null || isSafeId(check["safeReasonCode"]))
    );
  });
  const artifactsValid = body["externalArtifacts"].every((candidate: unknown) => {
    if (!isPlainExactObject(candidate, externalArtifactKeys)) return false;
    const artifact = candidate as Record<string, unknown>;
    return (
      isSafeId(artifact["artifactId"]) &&
      typeof artifact["sha256"] === "string" &&
      SHA256_PATTERN.test(artifact["sha256"])
    );
  });
  return checksValid && artifactsValid;
}

function validRequirementIds(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((id: unknown) => {
      if (typeof id !== "string" || !/^FR-[0-9]{3}$/u.test(id)) return false;
      const number = Number(id.slice(3));
      return number >= 1 && number <= 120;
    }) &&
    new Set<string>(value).size === value.length
  );
}

function validSuccessCriterionIds(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((id: unknown) => {
      if (typeof id !== "string" || !/^SC-[0-9]{3}$/u.test(id)) return false;
      const number = Number(id.slice(3));
      return number >= 1 && number <= 26;
    }) &&
    new Set<string>(value).size === value.length
  );
}

function validStoryIds(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((id: unknown) => typeof id === "string" && /^US[1-8]$/u.test(id)) &&
    new Set<string>(value).size === value.length
  );
}

function validateEnvironment(value: unknown): value is EvidenceEnvironment {
  const current = isPlainExactObject(value, environmentKeys);
  const legacy = isPlainExactObject(value, legacyEnvironmentKeys);
  if (!current && !legacy) return false;
  const environment = value as Record<string, unknown>;
  const runtimeArtifact = current
    ? environment["runtimeArtifact"]
    : environment["ecsTaskDefinition"];
  return (
    isUniqueSafeIdArray(environment["browserDeviceVersions"]) &&
    isSafeId(environment["databaseEngineVersion"]) &&
    (runtimeArtifact === null || isSafeId(runtimeArtifact)) &&
    isUniqueSafeIdArray(environment["featureFlags"]) &&
    isSafeId(environment["migrationVersion"]) &&
    (environment["normalLoadProfile"] === null || isSafeId(environment["normalLoadProfile"]))
  );
}

function validateManifest(value: unknown): value is EvidenceManifestInput {
  if (!isPlainExactObject(value, manifestKeys)) return false;
  const manifest = value as Record<string, unknown>;
  if (
    manifest["artifactSha256"] !== null ||
    typeof manifest["buildDigest"] !== "string" ||
    !BUILD_DIGEST_PATTERN.test(manifest["buildDigest"]) ||
    !["pass", "fail", "blocked"].includes(String(manifest["coarseResult"])) ||
    !isSafeId(manifest["currencyRegistryVersion"]) ||
    !isSafeId(manifest["deployedConfigVersion"]) ||
    !validateEnvironment(manifest["environment"]) ||
    !isSafeId(manifest["environmentId"]) ||
    typeof manifest["evidenceId"] !== "string" ||
    !UUID_PATTERN.test(manifest["evidenceId"]) ||
    !isCanonicalTimestamp(manifest["startedAt"]) ||
    !isCanonicalTimestamp(manifest["finishedAt"]) ||
    typeof manifest["gitCommit"] !== "string" ||
    !GIT_COMMIT_PATTERN.test(manifest["gitCommit"]) ||
    !isUniqueSafeIdArray(manifest["providerDecisionVersions"]) ||
    !isSafeId(manifest["region"]) ||
    !validRequirementIds(manifest["requirementIds"]) ||
    !(manifest["reviewedAt"] === null || isCanonicalTimestamp(manifest["reviewedAt"])) ||
    !isSafeId(manifest["reviewerRole"]) ||
    !isSafeId(manifest["safeFixtureSetVersion"]) ||
    !validStoryIds(manifest["storyIds"]) ||
    !validSuccessCriterionIds(manifest["successCriterionIds"]) ||
    !isSafeId(manifest["testCommandOrProcedureId"]) ||
    !isSafeId(manifest["tzdbVersion"])
  ) {
    return false;
  }
  const startedAt = Date.parse(manifest["startedAt"]);
  const finishedAt = Date.parse(manifest["finishedAt"]);
  if (finishedAt < startedAt) return false;
  return manifest["reviewedAt"] === null || Date.parse(manifest["reviewedAt"]) >= finishedAt;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value.toString();
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  throw new EvidenceRejectedError(["schema_invalid"]);
}

function scanContent(
  content: string,
  forbiddenCanaries: readonly string[],
): EvidenceRejectionReason[] {
  const reasons = new Set<EvidenceRejectionReason>();
  if (forbiddenCanaries.some((canary) => canary.length > 0 && content.includes(canary))) {
    reasons.add("seeded_canary");
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(content)) reasons.add("email_like_content");
  if (
    /\b(?:Bearer\s+[A-Za-z0-9._~-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/u.test(
      content,
    )
  ) {
    reasons.add("credential_like_content");
  }
  if (/https?:\\?\/\\?\/[^\s"\\]+\?[^\s"\\]+/iu.test(content)) reasons.add("query_url");
  if (/\b[A-Z]{3}\s+[0-9]+(?:\.[0-9]+)?\b/u.test(content)) reasons.add("money_like_content");
  if (
    /\b(?:transcript|audio|note|prompt|providerPayload|searchTerm|detectorCandidate|normalizedDetectorMaterial)\b/iu.test(
      content,
    )
  ) {
    reasons.add("forbidden_content_field");
  }
  return [...reasons].sort();
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function underRoot(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  if (!target.startsWith(`${resolvedRoot}/`))
    throw new EvidenceRejectedError(["artifact_name_invalid"]);
  return target;
}

export class EvidenceWriter {
  private readonly acceptedDirectory: string;
  private readonly forbiddenCanaries: readonly string[];
  private readonly now: () => Date;
  private readonly quarantineDirectory: string;

  constructor(options: EvidenceWriterOptions) {
    this.acceptedDirectory = options.acceptedDirectory;
    this.forbiddenCanaries = options.forbiddenCanaries ?? [];
    this.now = options.now ?? (() => new Date());
    this.quarantineDirectory = options.quarantineDirectory;
  }

  async write(input: EvidenceRecordInput): Promise<EvidenceWriteResult> {
    await Promise.all([
      mkdir(this.acceptedDirectory, { mode: 0o700, recursive: true }),
      mkdir(this.quarantineDirectory, { mode: 0o700, recursive: true }),
    ]);

    let candidate = "unserializable";
    try {
      candidate = canonicalJson({ body: input.body, manifest: input.manifest });
    } catch {
      await this.quarantine(candidate, ["schema_invalid"]);
      throw new EvidenceRejectedError(["schema_invalid"]);
    }

    const reasons = scanContent(candidate, this.forbiddenCanaries);
    if (!ARTIFACT_NAME_PATTERN.test(input.artifactName)) reasons.push("artifact_name_invalid");
    if (!validateBody(input.body) || !validateManifest(input.manifest))
      reasons.push("schema_invalid");
    const uniqueReasons = [...new Set(reasons)].sort();
    if (uniqueReasons.length > 0) {
      await this.quarantine(candidate, uniqueReasons);
      throw new EvidenceRejectedError(uniqueReasons);
    }

    const artifactContent = `${canonicalJson(input.body)}\n`;
    const artifactSha256 = sha256(artifactContent);
    const manifest: EvidenceManifest = {
      ...input.manifest,
      artifactSha256,
      schemaVersion: "cashmemo-evidence-manifest-v1",
    };
    const manifestContent = `${canonicalJson(manifest)}\n`;
    const finalDirectory = underRoot(this.acceptedDirectory, input.manifest.evidenceId);
    const stagingDirectory = underRoot(
      this.acceptedDirectory,
      `.staging-${input.manifest.evidenceId}-${randomUUID()}`,
    );
    await mkdir(stagingDirectory, { mode: 0o700 });
    try {
      await Promise.all([
        writeFile(join(stagingDirectory, input.artifactName), artifactContent, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        }),
        writeFile(join(stagingDirectory, "manifest.json"), manifestContent, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        }),
      ]);
      await rename(stagingDirectory, finalDirectory);
    } catch (error: unknown) {
      await rm(stagingDirectory, { force: true, recursive: true });
      throw error;
    }
    return {
      artifactPath: join(finalDirectory, input.artifactName),
      manifest,
      manifestPath: join(finalDirectory, "manifest.json"),
    };
  }

  private async quarantine(
    candidate: string,
    reasons: readonly EvidenceRejectionReason[],
  ): Promise<void> {
    const marker = {
      artifactSha256: sha256(candidate),
      byteLength: Buffer.byteLength(candidate, "utf8"),
      reasonCodes: [...reasons].sort(),
      rejectedAt: this.now().toISOString(),
      schemaVersion: "cashmemo-evidence-quarantine-v1",
    };
    const markerPath = underRoot(this.quarantineDirectory, `${randomUUID()}.json`);
    await writeFile(markerPath, `${canonicalJson(marker)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
}
