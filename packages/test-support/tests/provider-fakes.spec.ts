import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";

import { buildDiagnosticEvent } from "../../domain/src/telemetry/diagnostic-event.js";
import {
  FakeEmailPort,
  FakeExtractionPort,
  FakeObjectStorePort,
  FakeProviderContractError,
  FakeSttPort,
  FakeTelemetryPort,
  type EphemeralAudioSource,
  type ObjectClass,
} from "../src/providers/fakes.js";

const now = () => new Date("2026-08-09T08:00:00.000Z");
const correlationId = "018f0f50-b524-7c5f-8e89-0242ac120002";

function audioSource(...chunks: number[][]): EphemeralAudioSource {
  return {
    async *chunks() {
      for (const chunk of chunks) {
        await Promise.resolve();
        yield Uint8Array.from(chunk);
      }
    },
  };
}

describe("strict provider fakes", () => {
  it("consumes STT audio without retaining raw bytes in call capture", async () => {
    const stt = new FakeSttPort({
      now,
      results: [
        {
          completeness: "complete",
          kind: "transcript",
          language: "en",
          text: "synthetic money event",
          truncation: "none",
        },
      ],
    });
    await expect(
      stt.transcribe({
        audio: audioSource([1, 2], [3]),
        byteLength: 3,
        consentVersion: "stt-consent-v1",
        correlationId,
        deadlineAt: "2026-08-09T08:00:30.000Z",
        languageHint: "en",
        measuredDurationMs: 1_000,
        mediaType: "webm_opus",
        providerDecisionVersion: "openai-stt-v1",
      }),
    ).resolves.toMatchObject({ kind: "transcript" });
    expect(stt.calls).toEqual([
      {
        byteLength: 3,
        correlationId,
        measuredDurationMs: 1_000,
        mediaType: "webm_opus",
        providerDecisionVersion: "openai-stt-v1",
      },
    ]);
    expect(JSON.stringify(stt.calls)).not.toContain("[1,2,3]");
  });

  it("fails STT on byte mismatch, duration overflow, elapsed deadline, and script exhaustion", async () => {
    const stt = new FakeSttPort({ now, results: [] });
    const base = {
      audio: audioSource([1]),
      byteLength: 2,
      consentVersion: "stt-consent-v1",
      correlationId,
      deadlineAt: "2026-08-09T08:00:30.000Z",
      languageHint: null,
      measuredDurationMs: 1_000,
      mediaType: "wav_pcm" as const,
      providerDecisionVersion: "openai-stt-v1",
    };
    await expect(stt.transcribe(base)).rejects.toBeInstanceOf(FakeProviderContractError);
    await expect(
      stt.transcribe({ ...base, audio: audioSource([1], [2]), measuredDurationMs: 60_001 }),
    ).rejects.toBeInstanceOf(FakeProviderContractError);
    await expect(
      stt.transcribe({
        ...base,
        audio: audioSource([1], [2]),
        deadlineAt: "2026-08-09T08:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(FakeProviderContractError);
    await expect(stt.transcribe({ ...base, audio: audioSource([1], [2]) })).rejects.toBeInstanceOf(
      FakeProviderContractError,
    );
  });

  it("scripts provider-neutral extraction and email results", async () => {
    const extraction = new FakeExtractionPort({
      now,
      results: [{ kind: "correction_required", safeReasonCodes: ["AMBIGUOUS_AMOUNT"] }],
    });
    await expect(
      extraction.extract({
        allowedCategories: [],
        allowedMoneySpaces: [],
        captureStartedAt: "2026-08-09T08:00:00.000Z",
        captureText: "synthetic event",
        captureTimezone: "Asia/Jakarta",
        consentVersion: "ai-consent-v1",
        correlationId,
        deadlineAt: "2026-08-09T08:00:30.000Z",
        defaultCurrency: "IDR",
        locale: "en-ID",
        providerDecisionVersion: "openai-extraction-v1",
        schemaVersion: "money-memo-draft-1",
      }),
    ).resolves.toEqual({ kind: "correction_required", safeReasonCodes: ["AMBIGUOUS_AMOUNT"] });

    const email = new FakeEmailPort([{ kind: "accepted", providerReferenceHmac: "a".repeat(64) }]);
    await expect(
      email.sendTransactional({
        destination: "synthetic@example.com",
        expiresAt: "2026-08-09T08:10:00.000Z",
        kind: "verify_email",
        locale: "en-ID",
        oneTimeUrl: "https://cashmemo.test/verify-email/synthetic-token",
        providerDecisionVersion: "ses-v1",
      }),
    ).resolves.toMatchObject({ kind: "accepted" });
  });

  it("stores only allowed object classes with checksum and suppression TTL rules", async () => {
    const store = new FakeObjectStorePort();
    const body = new TextEncoder().encode('{"safe":true}');
    const checksum = createHash("sha256").update(body).digest("hex");
    const stored = await store.put({
      accountScopeHmac: "b".repeat(64),
      body,
      expectedSha256: checksum,
      kmsKeyPolicy: "test-evidence-key-v1",
      maximumExpiryAt: "2026-08-10T08:00:00.000Z",
      objectClass: "acceptance_evidence",
    });
    expect(await store.get(stored.objectReference)).toEqual(body);
    expect(await store.delete(stored.objectReference)).toEqual({ deleted: true });
    await expect(store.get(stored.objectReference)).rejects.toBeInstanceOf(
      FakeProviderContractError,
    );
    await expect(
      store.put({
        accountScopeHmac: "b".repeat(64),
        body,
        expectedSha256: checksum,
        kmsKeyPolicy: "synthetic-policy-v1",
        maximumExpiryAt: "2026-09-20T08:00:00.000Z",
        objectClass: "deletion_suppression",
      }),
    ).rejects.toBeInstanceOf(FakeProviderContractError);
  });

  it("accepts only typed safe diagnostic events", () => {
    const telemetry = new FakeTelemetryPort();
    telemetry.emit(
      buildDiagnosticEvent({
        buildVersion: "test-v1",
        correlationId,
        durationBucket: "lt_50ms",
        operation: "capture.stt",
        outcome: "success",
        serviceHealth: "healthy",
      }),
    );
    expect(telemetry.events).toHaveLength(1);

    const compileOnly = (): void => {
      // @ts-expect-error raw audio is not a storage object class
      const forbidden: ObjectClass = "raw_audio";
      expectTypeOf(forbidden).toEqualTypeOf<ObjectClass>();
      // @ts-expect-error telemetry fake has no generic object/log method
      telemetry.emit({ body: "PRIVATE_CANARY" });
    };
    expectTypeOf(compileOnly).toBeFunction();
  });
});
