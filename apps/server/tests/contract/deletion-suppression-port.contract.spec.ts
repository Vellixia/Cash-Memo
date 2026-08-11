import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ContractDeletionSuppressionPort,
  REMOVAL_FLOOR_MILLISECONDS,
  createSuppressionRecord,
  deriveDeletionToken,
} from "../../src/modules/deletion/deletion-suppression.port.js";

const KEY = Buffer.from("synthetic-suppression-key-material-v1-000000", "utf8");
const MEMO_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const PURGED_AT = new Date("2026-08-11T12:00:00.000Z");

function record() {
  return createSuppressionRecord({
    entityId: MEMO_ID,
    entityType: "money_memo",
    policyVersion: "deletion-policy-v1",
    purgedAt: PURGED_AT,
    suppressionKey: KEY,
    suppressionKeyVersion: "key-v1",
  });
}

describe("deletion suppression port contract", () => {
  it("derives exact HMAC-SHA-256 over entity_type:canonical_uuid", () => {
    const actual = deriveDeletionToken({
      entityId: MEMO_ID,
      entityType: "money_memo",
      suppressionKey: KEY,
    });
    const expected = createHmac("sha256", KEY).update(`money_memo:${MEMO_ID}`).digest();
    expect(actual.equals(expected)).toBe(true);
    expect(actual).toHaveLength(32);
  });

  it("canonicalizes uppercase UUID text before derivation", () => {
    expect(
      deriveDeletionToken({
        entityId: MEMO_ID.toUpperCase(),
        entityType: "money_memo",
        suppressionKey: KEY,
      }).equals(
        deriveDeletionToken({ entityId: MEMO_ID, entityType: "money_memo", suppressionKey: KEY }),
      ),
    ).toBe(true);
  });

  it("separates entity types", () => {
    const memo = deriveDeletionToken({
      entityId: MEMO_ID,
      entityType: "money_memo",
      suppressionKey: KEY,
    });
    const account = deriveDeletionToken({
      entityId: MEMO_ID,
      entityType: "account",
      suppressionKey: KEY,
    });
    expect(memo.equals(account)).toBe(false);
  });

  it("separates immutable UUIDs", () => {
    const one = deriveDeletionToken({
      entityId: MEMO_ID,
      entityType: "money_memo",
      suppressionKey: KEY,
    });
    const two = deriveDeletionToken({
      entityId: OTHER_ID,
      entityType: "money_memo",
      suppressionKey: KEY,
    });
    expect(one.equals(two)).toBe(false);
  });

  it("records key version and 42-day removal floor without TTL authority", () => {
    const value = record();
    expect(value.suppressionKeyVersion).toBe("key-v1");
    expect(value.removalNotBeforeAt.getTime() - value.purgedAt.getTime()).toBe(
      REMOVAL_FLOOR_MILLISECONDS,
    );
    expect(value).not.toHaveProperty("expiresAt");
    expect(value).not.toHaveProperty("ttl");
    expect(value).not.toHaveProperty("deleteAfterDays");
  });

  it("stores no raw identity or user content", async () => {
    const port = new ContractDeletionSuppressionPort();
    const written = await port.ensureDurable(record());
    const serialized = JSON.stringify({
      ...written.record,
      deletionToken: written.record.deletionToken.toString("hex"),
    });
    expect(serialized).not.toContain(MEMO_ID);
    expect(serialized).not.toMatch(/email|amount|note|label|memo content|accountId|userId/iu);
  });

  it("performs conditional idempotent writes", async () => {
    const port = new ContractDeletionSuppressionPort();
    await expect(port.ensureDurable(record())).resolves.toMatchObject({
      result: "written",
      verifiedDurable: true,
    });
    await expect(port.ensureDurable(record())).resolves.toMatchObject({
      result: "existing",
      verifiedDurable: true,
    });
    expect(port.countForTest()).toBe(1);
  });

  it("models durable write failure without creating a record", async () => {
    const port = new ContractDeletionSuppressionPort();
    port.setWriteFailureForTest(true);
    await expect(port.ensureDurable(record())).rejects.toThrow("SUPPRESSION_DURABLE_WRITE_FAILED");
    expect(port.countForTest()).toBe(0);
  });

  it("allows retry after a write failure", async () => {
    const port = new ContractDeletionSuppressionPort();
    port.setWriteFailureForTest(true);
    await expect(port.ensureDurable(record())).rejects.toThrow();
    port.setWriteFailureForTest(false);
    await expect(port.ensureDurable(record())).resolves.toMatchObject({ verifiedDurable: true });
  });

  it("verifies durable presence by token and key version", async () => {
    const port = new ContractDeletionSuppressionPort();
    const value = record();
    await port.ensureDurable(value);
    await expect(port.verifyDurable(value.deletionToken, "key-v1")).resolves.toMatchObject({
      entityType: "money_memo",
    });
    await expect(port.verifyDurable(value.deletionToken, "key-v2")).resolves.toBeNull();
  });

  it("exposes no normal removal or TTL API", () => {
    const methods = Object.getOwnPropertyNames(ContractDeletionSuppressionPort.prototype);
    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("remove");
    expect(methods).not.toContain("setTtl");
    expect(methods).not.toContain("expire");
  });
});
