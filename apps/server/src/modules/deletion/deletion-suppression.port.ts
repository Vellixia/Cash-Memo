import { createHmac, timingSafeEqual } from "node:crypto";

type DeletionEntityType = "account" | "money_memo";
type SuppressionWriteResult = "existing" | "written";

interface DeletionSuppressionRecord {
  readonly blockingArtifactClasses: readonly string[];
  readonly deletionToken: Buffer;
  readonly entityType: DeletionEntityType;
  readonly policyVersion: string;
  readonly purgedAt: Date;
  readonly removalNotBeforeAt: Date;
  readonly suppressionKeyVersion: string;
  readonly verificationState: "not_due";
}

interface DeletionSuppressionWrite {
  readonly record: DeletionSuppressionRecord;
  readonly result: SuppressionWriteResult;
  readonly verifiedDurable: true;
}

interface DeletionSuppressionPort {
  ensureDurable(record: Readonly<DeletionSuppressionRecord>): Promise<DeletionSuppressionWrite>;
  verifyDurable(
    deletionToken: Buffer,
    suppressionKeyVersion: string,
  ): Promise<DeletionSuppressionRecord | null>;
}

interface DeriveDeletionTokenInput {
  readonly entityId: string;
  readonly entityType: DeletionEntityType;
  readonly suppressionKey: Buffer;
}

interface CreateSuppressionRecordInput extends DeriveDeletionTokenInput {
  readonly policyVersion: string;
  readonly purgedAt: Date;
  readonly suppressionKeyVersion: string;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REMOVAL_FLOOR_MILLISECONDS = 42 * 24 * 60 * 60 * 1_000;

function canonicalUuid(value: string): string {
  if (!UUID_SHAPE.test(value)) throw new Error("INVALID_IMMUTABLE_ENTITY_ID");
  const canonical = value.toLowerCase();
  if (!CANONICAL_UUID.test(canonical)) throw new Error("INVALID_IMMUTABLE_ENTITY_ID");
  return canonical;
}

function deriveDeletionToken(input: Readonly<DeriveDeletionTokenInput>): Buffer {
  if (input.suppressionKey.length < 32) throw new Error("SUPPRESSION_KEY_TOO_SHORT");
  const message = `${input.entityType}:${canonicalUuid(input.entityId)}`;
  return createHmac("sha256", input.suppressionKey).update(message, "utf8").digest();
}

function createSuppressionRecord(
  input: Readonly<CreateSuppressionRecordInput>,
): DeletionSuppressionRecord {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.suppressionKeyVersion)) {
    throw new Error("INVALID_SUPPRESSION_KEY_VERSION");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(input.policyVersion)) {
    throw new Error("INVALID_SUPPRESSION_POLICY_VERSION");
  }
  return Object.freeze({
    blockingArtifactClasses: Object.freeze([]),
    deletionToken: deriveDeletionToken(input),
    entityType: input.entityType,
    policyVersion: input.policyVersion,
    purgedAt: new Date(input.purgedAt),
    removalNotBeforeAt: new Date(input.purgedAt.getTime() + REMOVAL_FLOOR_MILLISECONDS),
    suppressionKeyVersion: input.suppressionKeyVersion,
    verificationState: "not_due",
  });
}

function sameRecord(
  left: Readonly<DeletionSuppressionRecord>,
  right: Readonly<DeletionSuppressionRecord>,
): boolean {
  return (
    left.deletionToken.length === right.deletionToken.length &&
    timingSafeEqual(left.deletionToken, right.deletionToken) &&
    left.entityType === right.entityType &&
    left.policyVersion === right.policyVersion &&
    left.purgedAt.getTime() === right.purgedAt.getTime() &&
    left.removalNotBeforeAt.getTime() === right.removalNotBeforeAt.getTime() &&
    left.suppressionKeyVersion === right.suppressionKeyVersion
  );
}

class ContractDeletionSuppressionPort implements DeletionSuppressionPort {
  private readonly records = new Map<string, DeletionSuppressionRecord>();
  private writeFailure = false;

  setWriteFailureForTest(enabled: boolean): void {
    this.writeFailure = enabled;
  }

  async ensureDurable(
    record: Readonly<DeletionSuppressionRecord>,
  ): Promise<DeletionSuppressionWrite> {
    await Promise.resolve();
    if (this.writeFailure) throw new Error("SUPPRESSION_DURABLE_WRITE_FAILED");
    const key = `${record.suppressionKeyVersion}:${record.deletionToken.toString("hex")}`;
    const existing = this.records.get(key);
    if (existing !== undefined) {
      if (!sameRecord(existing, record)) throw new Error("SUPPRESSION_CONDITIONAL_WRITE_CONFLICT");
      return Object.freeze({ record: existing, result: "existing", verifiedDurable: true });
    }
    const stored = Object.freeze({
      ...record,
      blockingArtifactClasses: Object.freeze([...record.blockingArtifactClasses]),
      deletionToken: Buffer.from(record.deletionToken),
      purgedAt: new Date(record.purgedAt),
      removalNotBeforeAt: new Date(record.removalNotBeforeAt),
    });
    this.records.set(key, stored);
    return Object.freeze({ record: stored, result: "written", verifiedDurable: true });
  }

  async verifyDurable(
    deletionToken: Buffer,
    suppressionKeyVersion: string,
  ): Promise<DeletionSuppressionRecord | null> {
    await Promise.resolve();
    const record = this.records.get(`${suppressionKeyVersion}:${deletionToken.toString("hex")}`);
    return record === undefined
      ? null
      : Object.freeze({
          ...record,
          deletionToken: Buffer.from(record.deletionToken),
          purgedAt: new Date(record.purgedAt),
          removalNotBeforeAt: new Date(record.removalNotBeforeAt),
        });
  }

  countForTest(): number {
    return this.records.size;
  }
}

export {
  ContractDeletionSuppressionPort,
  REMOVAL_FLOOR_MILLISECONDS,
  canonicalUuid,
  createSuppressionRecord,
  deriveDeletionToken,
  type CreateSuppressionRecordInput,
  type DeletionEntityType,
  type DeletionSuppressionPort,
  type DeletionSuppressionRecord,
  type DeletionSuppressionWrite,
  type DeriveDeletionTokenInput,
  type SuppressionWriteResult,
};
