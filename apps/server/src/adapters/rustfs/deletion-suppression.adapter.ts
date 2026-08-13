import { createHash, timingSafeEqual } from "node:crypto";

import type {
  DeletionSuppressionPort,
  DeletionSuppressionRecord,
  DeletionSuppressionWrite,
} from "../../modules/deletion/deletion-suppression.port.js";

interface DeletionLedgerObject {
  readonly body: Buffer;
  readonly checksumSha256: string;
  readonly encryptedAtRest: boolean;
  readonly etag: string;
  readonly versionId: string;
}

interface S3CompatibleDeletionLedgerClient {
  deleteObject(input: {
    readonly bucket: string;
    readonly expectedVersionId: string;
    readonly key: string;
  }): Promise<void>;
  getObject(input: {
    readonly bucket: string;
    readonly key: string;
  }): Promise<DeletionLedgerObject | null>;
  putObject(input: {
    readonly body: Buffer;
    readonly bucket: string;
    readonly checksumSha256: string;
    readonly contentType: "application/vnd.cashmemo.deletion-suppression+json";
    readonly ifNoneMatch: "*";
    readonly key: string;
    readonly requireEncryptedStorage: true;
  }): Promise<{ readonly versionId: string }>;
}

interface RustfsDeletionSuppressionOptions {
  readonly bucket: string;
  readonly client: S3CompatibleDeletionLedgerClient;
  readonly namespace?: string;
}

interface VerifiedSuppressionRemoval {
  readonly expectedVersionId: string;
  readonly token: Buffer;
  readonly suppressionKeyVersion: string;
  readonly verifierDecision: "not_verified" | "verified_eligible";
}

interface DeletionSuppressionCleanupPort {
  loadForCleanup(
    token: Buffer,
    suppressionKeyVersion: string,
  ): Promise<{
    readonly record: DeletionSuppressionRecord;
    readonly versionId: string;
  } | null>;
  removeVerified(input: Readonly<VerifiedSuppressionRemoval>): Promise<void>;
}

interface StoredRecord {
  readonly blockingArtifactClasses: readonly string[];
  readonly deletionToken: string;
  readonly entityType: "account" | "money_memo";
  readonly policyVersion: string;
  readonly purgedAt: string;
  readonly removalNotBeforeAt: string;
  readonly suppressionKeyVersion: string;
  readonly verificationState: "not_due";
}

function assertOpaqueToken(token: Buffer): void {
  if (token.length !== 32) throw new Error("INVALID_DELETION_TOKEN");
}

function objectKey(
  token: Buffer,
  suppressionKeyVersion: string,
  namespace = "suppression",
): string {
  assertOpaqueToken(token);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(suppressionKeyVersion)) {
    throw new Error("INVALID_SUPPRESSION_KEY_VERSION");
  }
  if (!/^[a-z0-9][a-z0-9/_-]{0,127}$/u.test(namespace)) {
    throw new Error("INVALID_DELETION_LEDGER_NAMESPACE");
  }
  return `${namespace}/${suppressionKeyVersion}/${token.toString("hex")}.json`;
}

function encodeRecord(record: Readonly<DeletionSuppressionRecord>): Buffer {
  const stored: StoredRecord = {
    blockingArtifactClasses: [...record.blockingArtifactClasses].sort(),
    deletionToken: record.deletionToken.toString("hex"),
    entityType: record.entityType,
    policyVersion: record.policyVersion,
    purgedAt: record.purgedAt.toISOString(),
    removalNotBeforeAt: record.removalNotBeforeAt.toISOString(),
    suppressionKeyVersion: record.suppressionKeyVersion,
    verificationState: record.verificationState,
  };
  return Buffer.from(JSON.stringify(stored), "utf8");
}

function decodeRecord(body: Buffer): DeletionSuppressionRecord {
  const value = JSON.parse(body.toString("utf8")) as Partial<StoredRecord>;
  if (
    !Array.isArray(value.blockingArtifactClasses) ||
    typeof value.deletionToken !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.deletionToken) ||
    (value.entityType !== "account" && value.entityType !== "money_memo") ||
    typeof value.policyVersion !== "string" ||
    typeof value.purgedAt !== "string" ||
    typeof value.removalNotBeforeAt !== "string" ||
    typeof value.suppressionKeyVersion !== "string" ||
    value.verificationState !== "not_due"
  ) {
    throw new Error("SUPPRESSION_LEDGER_RECORD_INVALID");
  }
  return Object.freeze({
    blockingArtifactClasses: Object.freeze(value.blockingArtifactClasses.map(String).sort()),
    deletionToken: Buffer.from(value.deletionToken, "hex"),
    entityType: value.entityType,
    policyVersion: value.policyVersion,
    purgedAt: new Date(value.purgedAt),
    removalNotBeforeAt: new Date(value.removalNotBeforeAt),
    suppressionKeyVersion: value.suppressionKeyVersion,
    verificationState: "not_due" as const,
  });
}

function checksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function equalBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

class RustfsDeletionSuppressionAdapter
  implements DeletionSuppressionPort, DeletionSuppressionCleanupPort
{
  constructor(private readonly options: Readonly<RustfsDeletionSuppressionOptions>) {}

  async ensureDurable(
    record: Readonly<DeletionSuppressionRecord>,
  ): Promise<DeletionSuppressionWrite> {
    const key = objectKey(
      record.deletionToken,
      record.suppressionKeyVersion,
      this.options.namespace,
    );
    const body = encodeRecord(record);
    try {
      await this.options.client.putObject({
        body,
        bucket: this.options.bucket,
        checksumSha256: checksum(body),
        contentType: "application/vnd.cashmemo.deletion-suppression+json",
        ifNoneMatch: "*",
        key,
        requireEncryptedStorage: true,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !["CONDITIONAL_WRITE_EXISTS", "S3_COMPATIBLE_AMBIGUOUS_RESPONSE"].includes(error.message)
      ) {
        throw error;
      }
    }
    const verified = await this.readVerified(key);
    if (verified === null || !equalBytes(encodeRecord(verified.record), body)) {
      throw new Error("SUPPRESSION_DURABILITY_UNVERIFIABLE");
    }
    return Object.freeze({ record: verified.record, result: "written", verifiedDurable: true });
  }

  async verifyDurable(
    deletionToken: Buffer,
    suppressionKeyVersion: string,
  ): Promise<DeletionSuppressionRecord | null> {
    return (
      (
        await this.readVerified(
          objectKey(deletionToken, suppressionKeyVersion, this.options.namespace),
        )
      )?.record ?? null
    );
  }

  async loadForCleanup(token: Buffer, suppressionKeyVersion: string) {
    return this.readVerified(objectKey(token, suppressionKeyVersion, this.options.namespace));
  }

  async removeVerified(input: Readonly<VerifiedSuppressionRemoval>): Promise<void> {
    if (input.verifierDecision !== "verified_eligible") {
      throw new Error("SUPPRESSION_REMOVAL_NOT_AUTHORIZED");
    }
    await this.options.client.deleteObject({
      bucket: this.options.bucket,
      expectedVersionId: input.expectedVersionId,
      key: objectKey(input.token, input.suppressionKeyVersion, this.options.namespace),
    });
    if (
      (await this.options.client.getObject({
        bucket: this.options.bucket,
        key: objectKey(input.token, input.suppressionKeyVersion, this.options.namespace),
      })) !== null
    ) {
      throw new Error("SUPPRESSION_REMOVAL_UNVERIFIABLE");
    }
  }

  private async readVerified(key: string): Promise<{
    readonly record: DeletionSuppressionRecord;
    readonly versionId: string;
  } | null> {
    const object = await this.options.client.getObject({ bucket: this.options.bucket, key });
    if (object === null) return null;
    if (!object.encryptedAtRest || checksum(object.body) !== object.checksumSha256) {
      throw new Error("SUPPRESSION_DURABILITY_UNVERIFIABLE");
    }
    return Object.freeze({ record: decodeRecord(object.body), versionId: object.versionId });
  }
}

class ContractS3CompatibleDeletionLedgerClient implements S3CompatibleDeletionLedgerClient {
  private readonly objects = new Map<string, DeletionLedgerObject>();
  private sequence = 0;
  private fault: "ambiguous" | "none" | "unavailable" | "write_failure" = "none";
  private lastPut: Parameters<S3CompatibleDeletionLedgerClient["putObject"]>[0] | null = null;

  setFaultForTest(fault: "ambiguous" | "none" | "unavailable" | "write_failure"): void {
    this.fault = fault;
  }

  async putObject(input: Parameters<S3CompatibleDeletionLedgerClient["putObject"]>[0]) {
    await Promise.resolve();
    if (this.fault === "write_failure") throw new Error("SUPPRESSION_DURABLE_WRITE_FAILED");
    if (this.objects.has(input.key)) throw new Error("CONDITIONAL_WRITE_EXISTS");
    this.lastPut = { ...input, body: Buffer.from(input.body) };
    this.sequence += 1;
    const versionId = `contract-version-${String(this.sequence)}`;
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      checksumSha256: input.checksumSha256,
      encryptedAtRest: input.requireEncryptedStorage,
      etag: checksum(input.body),
      versionId,
    });
    return { versionId };
  }

  async getObject(input: Parameters<S3CompatibleDeletionLedgerClient["getObject"]>[0]) {
    await Promise.resolve();
    if (this.fault === "unavailable") throw new Error("SUPPRESSION_LEDGER_UNAVAILABLE");
    if (this.fault === "ambiguous") return null;
    const value = this.objects.get(input.key);
    return value === undefined ? null : { ...value, body: Buffer.from(value.body) };
  }

  async deleteObject(input: Parameters<S3CompatibleDeletionLedgerClient["deleteObject"]>[0]) {
    await Promise.resolve();
    const value = this.objects.get(input.key);
    if (value?.versionId !== input.expectedVersionId) {
      throw new Error("SUPPRESSION_REMOVAL_VERSION_CONFLICT");
    }
    this.objects.delete(input.key);
  }

  storedBodiesForTest(): readonly string[] {
    return [...this.objects.values()].map((value) => value.body.toString("utf8"));
  }

  lastPutForTest(): Parameters<S3CompatibleDeletionLedgerClient["putObject"]>[0] | null {
    return this.lastPut === null ? null : { ...this.lastPut, body: Buffer.from(this.lastPut.body) };
  }
}

export {
  ContractS3CompatibleDeletionLedgerClient,
  RustfsDeletionSuppressionAdapter,
  decodeRecord,
  encodeRecord,
  objectKey,
  type RustfsDeletionSuppressionOptions,
  type DeletionSuppressionCleanupPort,
  type S3CompatibleDeletionLedgerClient,
  type VerifiedSuppressionRemoval,
};
