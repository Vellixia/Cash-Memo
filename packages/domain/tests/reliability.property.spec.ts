import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ReliabilityPrimitiveError,
  canonicalRequestHmac,
  classifyIdempotentRetry,
  compareAndAdvanceRevision,
  deterministicJobKey,
  parseRevision,
  requestHmacEqual,
} from "../src/reliability/primitives.js";

const hmacKey = new TextEncoder().encode("0123456789abcdef0123456789abcdef");

describe("reliability primitives", () => {
  it("parses canonical positive decimal revisions only", () => {
    expect(parseRevision("1")).toBe(1n);
    expect(parseRevision("9223372036854775807")).toBe(9_223_372_036_854_775_807n);
    for (const invalid of ["", "0", "01", "-1", "+1", "1.0", " 1", "1 ", "1e3"]) {
      expect(() => parseRevision(invalid)).toThrow(ReliabilityPrimitiveError);
    }
    expect(() => parseRevision("9223372036854775808")).toThrow(ReliabilityPrimitiveError);
  });

  it("advances only an exact current revision and reports stale conflicts", () => {
    expect(compareAndAdvanceRevision("41", "41")).toEqual({
      currentRevision: "41",
      nextRevision: "42",
      outcome: "advanced",
    });
    expect(compareAndAdvanceRevision("40", "41")).toEqual({
      currentRevision: "41",
      outcome: "conflict",
    });
  });

  it("keeps revision advancement monotonic across generated valid values", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 9_223_372_036_854_775_806n }), (revision) => {
        const result = compareAndAdvanceRevision(revision.toString(), revision.toString());
        expect(result).toEqual({
          currentRevision: revision.toString(),
          nextRevision: (revision + 1n).toString(),
          outcome: "advanced",
        });
      }),
      { numRuns: 10_000 },
    );
  });

  it("canonicalizes object keys while preserving array order and value types", () => {
    const first = canonicalRequestHmac({
      hmacKey,
      operation: "money_memo.create",
      payload: {
        fields: { amount: "85.00", currency: "USD" },
        tags: ["work", "lunch"],
      },
      schemaVersion: "money-memo-create-v1",
    });
    const reordered = canonicalRequestHmac({
      hmacKey,
      operation: "money_memo.create",
      payload: {
        tags: ["work", "lunch"],
        fields: { currency: "USD", amount: "85.00" },
      },
      schemaVersion: "money-memo-create-v1",
    });
    const different = canonicalRequestHmac({
      hmacKey,
      operation: "money_memo.create",
      payload: {
        fields: { amount: "85.01", currency: "USD" },
        tags: ["work", "lunch"],
      },
      schemaVersion: "money-memo-create-v1",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered).toBe(first);
    expect(different).not.toBe(first);
    expect(first).not.toContain("85.00");
    expect(first).not.toContain("USD");
  });

  it("domain-separates request HMACs by operation and schema version", () => {
    const payload = { id: "018f0f50-b524-7c5f-8e89-0242ac120002" };
    const base = canonicalRequestHmac({
      hmacKey,
      operation: "money_memo.create",
      payload,
      schemaVersion: "v1",
    });
    expect(
      canonicalRequestHmac({
        hmacKey,
        operation: "draft.confirm",
        payload,
        schemaVersion: "v1",
      }),
    ).not.toBe(base);
    expect(
      canonicalRequestHmac({
        hmacKey,
        operation: "money_memo.create",
        payload,
        schemaVersion: "v2",
      }),
    ).not.toBe(base);
  });

  it("rejects non-JSON, unsafe-number, and prototype-bearing request payloads", () => {
    for (const payload of [
      { value: undefined },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: 9_007_199_254_740_992 },
      { value: 1.5 },
      Object.assign(Object.create({ inherited: true }) as object, { value: "safe" }),
    ]) {
      expect(() =>
        canonicalRequestHmac({
          hmacKey,
          operation: "money_memo.create",
          payload,
          schemaVersion: "v1",
        }),
      ).toThrow(ReliabilityPrimitiveError);
    }
  });

  it("classifies same-key retries without replaying different content", () => {
    const requestHmac = canonicalRequestHmac({
      hmacKey,
      operation: "draft.confirm",
      payload: { draftId: "018f0f50-b524-7c5f-8e89-0242ac120002" },
      schemaVersion: "draft-confirm-v1",
    });
    const differentHmac = canonicalRequestHmac({
      hmacKey,
      operation: "draft.confirm",
      payload: { draftId: "018f0f50-b524-7c5f-8e89-0242ac120003" },
      schemaVersion: "draft-confirm-v1",
    });

    expect(classifyIdempotentRetry(null, requestHmac)).toEqual({ outcome: "begin" });
    expect(classifyIdempotentRetry({ requestHmac, state: "in_progress" }, requestHmac)).toEqual({
      outcome: "operation_in_progress",
    });
    expect(
      classifyIdempotentRetry(
        {
          requestHmac,
          result: {
            id: "018f0f50-b524-7c5f-8e89-0242ac120004",
            revision: "1",
            type: "money_memo",
          },
          state: "succeeded",
        },
        requestHmac,
      ),
    ).toEqual({
      outcome: "replay_success",
      result: {
        id: "018f0f50-b524-7c5f-8e89-0242ac120004",
        revision: "1",
        type: "money_memo",
      },
    });
    expect(
      classifyIdempotentRetry({ requestHmac, state: "failed_retryable" }, requestHmac),
    ).toEqual({ outcome: "retry" });
    expect(
      classifyIdempotentRetry(
        { requestHmac, responseCode: "VALIDATION_FAILED", state: "failed_final" },
        requestHmac,
      ),
    ).toEqual({ outcome: "replay_final", responseCode: "VALIDATION_FAILED" });
    expect(classifyIdempotentRetry({ requestHmac, state: "succeeded" }, differentHmac)).toEqual({
      outcome: "idempotency_conflict",
    });
    expect(requestHmacEqual(requestHmac, requestHmac)).toBe(true);
    expect(requestHmacEqual(requestHmac, differentHmac)).toBe(false);
  });

  it("never classifies a different payload HMAC as a replay", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (firstId, secondId) => {
        fc.pre(firstId !== secondId);
        const first = canonicalRequestHmac({
          hmacKey,
          operation: "money_memo.create",
          payload: { memoId: firstId },
          schemaVersion: "v1",
        });
        const second = canonicalRequestHmac({
          hmacKey,
          operation: "money_memo.create",
          payload: { memoId: secondId },
          schemaVersion: "v1",
        });
        expect(
          classifyIdempotentRetry({ requestHmac: first, state: "in_progress" }, second),
        ).toEqual({ outcome: "idempotency_conflict" });
      }),
      { numRuns: 10_000 },
    );
  });

  it("derives deterministic content-free job keys with scope separation", () => {
    const input = {
      hmacKey,
      jobType: "memo_purge",
      referenceType: "money_memo",
      referenceId: "018f0f50-b524-7c5f-8e89-0242ac120002",
      scheduleIdentity: "2026-08-01T00:00:00.000Z",
    } as const;
    const first = deterministicJobKey(input);
    expect(deterministicJobKey(input)).toBe(first);
    expect(first).toMatch(/^job:v1:[a-f0-9]{64}$/u);
    expect(first).not.toContain(input.referenceId);
    expect(deterministicJobKey({ ...input, jobType: "export_delete" })).not.toBe(first);
  });
});
