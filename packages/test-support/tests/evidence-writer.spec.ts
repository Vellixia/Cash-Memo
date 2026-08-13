import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import {
  EvidenceRejectedError,
  EvidenceWriter,
  type EvidenceArtifactBody,
  type EvidenceRecordInput,
} from "../src/evidence/evidence-writer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createWriter(forbiddenCanaries: readonly string[] = []): Promise<{
  root: string;
  writer: EvidenceWriter;
}> {
  const root = await mkdtemp(join(tmpdir(), "cashmemo-evidence-writer-"));
  temporaryDirectories.push(root);
  return {
    root,
    writer: new EvidenceWriter({
      acceptedDirectory: join(root, "accepted"),
      forbiddenCanaries,
      now: () => new Date("2026-08-09T08:00:00.000Z"),
      quarantineDirectory: join(root, "quarantine"),
    }),
  };
}

const safeBody: EvidenceArtifactBody = {
  checks: [
    {
      checkId: "money-roundtrip",
      count: 10_000,
      durationMs: 125,
      fixtureId: "money-property-v1",
      result: "pass",
      safeReasonCode: null,
    },
  ],
  externalArtifacts: [
    {
      artifactId: "protected-ci-run-101",
      sha256: "a".repeat(64),
    },
  ],
  schemaVersion: "cashmemo-evidence-artifact-v1",
};

const safeRecord: EvidenceRecordInput = {
  artifactName: "phase-2-domain.json",
  body: safeBody,
  manifest: {
    artifactSha256: null,
    buildDigest: `sha256:${"b".repeat(64)}`,
    coarseResult: "pass",
    currencyRegistryVersion: "cldr47-iso4217-2026-01-01-cashmemo-v1",
    deployedConfigVersion: "local-v1",
    environment: {
      browserDeviceVersions: [],
      databaseEngineVersion: "postgresql-18.0",
      runtimeArtifact: null,
      featureFlags: ["fake-providers"],
      migrationVersion: "none",
      normalLoadProfile: null,
    },
    environmentId: "local-ci",
    evidenceId: "018f0f50-b524-7c5f-8e89-0242ac120002",
    finishedAt: "2026-08-09T07:59:30.000Z",
    gitCommit: "c".repeat(40),
    providerDecisionVersions: [],
    region: "local",
    requirementIds: ["FR-104", "FR-118", "FR-119"],
    reviewedAt: null,
    reviewerRole: "engineering-owner",
    safeFixtureSetVersion: "synthetic-v1",
    startedAt: "2026-08-09T07:59:00.000Z",
    storyIds: [],
    successCriterionIds: [],
    testCommandOrProcedureId: "test-evidence-writer-v1",
    tzdbVersion: "2025b",
  },
};

describe("content-safe evidence writer", () => {
  it("writes a canonical safe artifact and hash-only manifest", async () => {
    const { writer } = await createWriter();
    const result = await writer.write(safeRecord);
    const artifactText = await readFile(result.artifactPath, "utf8");
    const manifestText = await readFile(result.manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;

    expect(artifactText.endsWith("\n")).toBe(true);
    expect(manifest).toEqual(result.manifest);
    expect(manifest["artifactSha256"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifestText).not.toContain("money-roundtrip");
    expect(manifestText).not.toContain("protected-ci-run-101");
    expect(Object.keys(manifest).sort()).toEqual([
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
      "schemaVersion",
      "startedAt",
      "storyIds",
      "successCriterionIds",
      "testCommandOrProcedureId",
      "tzdbVersion",
    ]);
  });

  it("quarantines a seeded canary without persisting rejected bytes", async () => {
    const canary = "PRIVATE_CANARY_7f96bd87";
    const { root, writer } = await createWriter([canary]);
    const rejected = {
      ...safeRecord,
      body: {
        ...safeBody,
        checks: [{ ...safeBody.checks[0], safeReasonCode: canary }],
      },
    } as EvidenceRecordInput;

    let error: unknown;
    try {
      await writer.write(rejected);
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EvidenceRejectedError);
    expect(String(error)).not.toContain(canary);
    expect(await readdir(join(root, "accepted"))).toEqual([]);
    const quarantineFiles = await readdir(join(root, "quarantine"));
    expect(quarantineFiles).toHaveLength(1);
    const [quarantineFile] = quarantineFiles;
    if (quarantineFile === undefined) throw new Error("Expected one quarantine marker");
    const marker = await readFile(join(root, "quarantine", quarantineFile), "utf8");
    expect(marker).not.toContain(canary);
    expect(marker).toContain("seeded_canary");
    expect(marker).toMatch(/[a-f0-9]{64}/u);
  });

  it.each([
    ["email", "person@example.com"],
    ["credential", "Bearer abcdefghijklmnopqrstuvwxyz"],
    ["provider secret", "sk-proj-abcdefghijklmnopqrstuvwxyz"],
    ["query URL", "https://example.invalid/path?token=value"],
    ["money fixture", "USD 85.00"],
    ["forbidden key", '"transcript":"synthetic phrase"'],
    ["detector key", '"normalizedDetectorMaterial":"digits"'],
  ])("rejects and content-free quarantines %s", async (_name, suspect) => {
    const { root, writer } = await createWriter();
    const body = {
      ...safeBody,
      checks: [{ ...safeBody.checks[0], safeReasonCode: suspect }],
    } as EvidenceArtifactBody;

    await expect(writer.write({ ...safeRecord, body })).rejects.toBeInstanceOf(
      EvidenceRejectedError,
    );
    const quarantineFiles = await readdir(join(root, "quarantine"));
    const [quarantineFile] = quarantineFiles;
    if (quarantineFile === undefined) throw new Error("Expected one quarantine marker");
    const marker = await readFile(join(root, "quarantine", quarantineFile), "utf8");
    expect(marker).not.toContain(suspect);
  });

  it("rejects traversal names, unknown body keys, and malformed manifest IDs", async () => {
    const { writer } = await createWriter();
    await expect(
      writer.write({ ...safeRecord, artifactName: "../escape.json" }),
    ).rejects.toBeInstanceOf(EvidenceRejectedError);
    await expect(
      writer.write({
        ...safeRecord,
        body: { ...safeBody, freeform: "not allowed" } as EvidenceArtifactBody,
      }),
    ).rejects.toBeInstanceOf(EvidenceRejectedError);
    await expect(
      writer.write({
        ...safeRecord,
        manifest: { ...safeRecord.manifest, requirementIds: ["FR-999"] },
      }),
    ).rejects.toBeInstanceOf(EvidenceRejectedError);
  });

  it("has no compile-time free-form body or manifest extension", () => {
    const compileOnly = async (writer: EvidenceWriter): Promise<void> => {
      await writer.write({
        ...safeRecord,
        body: {
          ...safeBody,
          // @ts-expect-error free-form evidence fields are forbidden
          details: "PRIVATE_CANARY",
        },
      });
      await writer.write({
        ...safeRecord,
        manifest: {
          ...safeRecord.manifest,
          // @ts-expect-error manifest accepts no notes or content fields
          notes: "PRIVATE_CANARY",
        },
      });
    };

    expectTypeOf(compileOnly).toBeFunction();
  });
});
