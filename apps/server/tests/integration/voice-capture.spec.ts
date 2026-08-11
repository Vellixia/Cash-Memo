/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FinitePrivacyBoundary } from "@cashmemo/privacy-rules";

import {
  DeterministicExtractionAdapter,
  DeterministicSttAdapter,
} from "../../src/adapters/fakes/assisted-provider.adapters.js";
import type { SttPort } from "../../src/modules/assisted-capture/provider-ports.js";
import {
  TemporaryAudioService,
  type AudioInspectorPort,
} from "../../src/modules/assisted-capture/temporary-audio.service.js";
import { TranscriptService } from "../../src/modules/assisted-capture/transcript.service.js";
import { VoiceCaptureService } from "../../src/modules/assisted-capture/voice-capture.service.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000136";
const OTHER = "00000000-0000-4000-8000-000000000137";
const WAV = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")]);
const startInput = {
  aiConsent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION" as const,
  captureStartedAt: "2026-08-11T10:00:00Z",
  captureTimezone: "UTC",
  detectorLimitationDisclosed: true as const,
  sttConsent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION" as const,
};

const inspector: AudioInspectorPort = {
  inspect: async () => ({
    codec: "pcm",
    detectedMediaType: "audio/wav",
    measuredDurationMs: 1_000,
  }),
};

describe("voice capture state machine", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;
  let runtimePool: Pool;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'voice-owner@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'voice-other@cashmemo.test', true, 'active')`,
      [ACCOUNT, OTHER],
    );
    runtimePool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  beforeEach(async () => {
    await adminPool.query("DELETE FROM temporary_audio_metadata");
    await adminPool.query("DELETE FROM provider_attempts");
    await adminPool.query("DELETE FROM assisted_captures");
    await adminPool.query("DELETE FROM compose_drafts");
    await adminPool.query("DELETE FROM money_memos");
  });

  afterAll(async () => {
    await runtimePool.end();
    await adminPool.end();
    await environment.stop();
  });

  function harness(
    options: {
      extractionMode?: ConstructorParameters<typeof DeterministicExtractionAdapter>[0]["mode"];
      stt?: SttPort;
      transcript?: string;
    } = {},
  ) {
    const extraction = new DeterministicExtractionAdapter({
      mode: options.extractionMode ?? "success",
    });
    const stt =
      options.stt ??
      new DeterministicSttAdapter({
        mode: "success",
        ...(options.transcript === undefined ? {} : { transcript: options.transcript }),
      });
    const audio = new TemporaryAudioService({
      inspector,
      ownerHmacKey: Buffer.from("synthetic-owner-key-32-bytes-long"),
      pool: runtimePool,
    });
    const transcript = new TranscriptService({
      extraction,
      now: () => new Date("2026-08-11T12:00:00Z"),
      pool: runtimePool,
      privacy: new FinitePrivacyBoundary(),
    });
    return {
      audio,
      extraction,
      service: new VoiceCaptureService({ audio, pool: runtimePool, stt, transcript }),
      stt,
    };
  }

  it("starts as non-authoritative recording with explicit consent", async () => {
    const { service } = harness();
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    expect(capture).toMatchObject({
      authoritative: false,
      draftId: expect.any(String),
      state: "recording",
    });
    expect(
      (await adminPool.query("SELECT count(*)::int AS count FROM money_memos")).rows[0],
    ).toEqual({ count: 0 });
  });

  it("moves upload through STT, transcript detection, extraction, and draft review only", async () => {
    const { audio, service } = harness();
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    const result = await service.upload(ACCOUNT, capture.id, crypto.randomUUID(), WAV, "audio/wav");
    expect(result.state).toBe("draft_review");
    expect(audio.entries()).toEqual([]);
    const draft = await adminPool.query<{ source_text: string; status: string }>(
      "SELECT source_text, status FROM compose_drafts WHERE id = $1",
      [capture.draftId],
    );
    expect(draft.rows[0]).toMatchObject({
      source_text: "synthetic complete transcript",
      status: "reviewable",
    });
    expect(
      (await adminPool.query("SELECT count(*)::int AS count FROM money_memos")).rows[0],
    ).toEqual({ count: 0 });
  });

  it("reconciles lost upload response retry without a second provider call", async () => {
    const { service, stt } = harness();
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    const key = crypto.randomUUID();
    const first = await service.upload(ACCOUNT, capture.id, key, WAV, "audio/wav");
    const second = await service.upload(ACCOUNT, capture.id, key, WAV, "audio/wav");
    expect(second).toEqual(first);
    expect((stt as DeterministicSttAdapter).calls).toHaveLength(1);
  });

  it("marks incomplete transcript visibly and never confirms it", async () => {
    const { service } = harness({ stt: new DeterministicSttAdapter({ mode: "incomplete" }) });
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    const result = await service.upload(ACCOUNT, capture.id, crypto.randomUUID(), WAV, "audio/wav");
    expect(result.state).toBe("correction_required");
    const draft = await adminPool.query<{ source_completeness: string }>(
      "SELECT source_completeness FROM compose_drafts WHERE id = $1",
      [capture.draftId],
    );
    expect(draft.rows[0]?.source_completeness).toBe("incomplete");
    expect(
      (await adminPool.query("SELECT count(*)::int AS count FROM money_memos")).rows[0],
    ).toEqual({ count: 0 });
  });

  it.each(["timeout", "rate_limit", "refusal", "failure"] as const)(
    "maps STT %s to safe recoverable state and deletes audio",
    async (mode) => {
      const { audio, service } = harness({ stt: new DeterministicSttAdapter({ mode }) });
      const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
      const result = await service.upload(
        ACCOUNT,
        capture.id,
        crypto.randomUUID(),
        WAV,
        "audio/wav",
      );
      expect(result).toMatchObject({ errorCode: "STT_UNAVAILABLE", state: "failed_recoverable" });
      expect(audio.entries()).toEqual([]);
      expect(
        (await adminPool.query("SELECT count(*)::int AS count FROM money_memos")).rows[0],
      ).toEqual({ count: 0 });
    },
  );

  it("keeps allowed transcript recoverable when extraction fails", async () => {
    const { service } = harness({ extractionMode: "failure" });
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    const result = await service.upload(ACCOUNT, capture.id, crypto.randomUUID(), WAV, "audio/wav");
    expect(result.state).toBe("failed_recoverable");
    const draft = await adminPool.query<{ source_text: string }>(
      "SELECT source_text FROM compose_drafts WHERE id = $1",
      [capture.draftId],
    );
    expect(draft.rows[0]?.source_text).toBe("synthetic complete transcript");
  });

  it("blocks prohibited transcript before persistence or extraction", async () => {
    const { extraction, service } = harness({ transcript: "CVV: 123" });
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    const result = await service.upload(ACCOUNT, capture.id, crypto.randomUUID(), WAV, "audio/wav");
    expect(result).toMatchObject({
      errorCode: "PRIVACY_BOUNDARY_BLOCKED",
      state: "failed_recoverable",
    });
    expect(extraction.calls).toEqual([]);
    const draft = await adminPool.query<{ source_text: string | null }>(
      "SELECT source_text FROM compose_drafts WHERE id = $1",
      [capture.draftId],
    );
    expect(draft.rows[0]?.source_text).toBeNull();
  });

  it("deletes audio and returns recoverable state when request/STT throws", async () => {
    const throwing: SttPort = {
      transcribe: async () => {
        throw new Error("private provider payload");
      },
    };
    const { audio, service } = harness({ stt: throwing });
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    const result = await service.upload(ACCOUNT, capture.id, crypto.randomUUID(), WAV, "audio/wav");
    expect(result.state).toBe("failed_recoverable");
    expect(audio.entries()).toEqual([]);
  });

  it("cancel deletes admitted raw bytes and is revision checked", async () => {
    const { audio, service } = harness();
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    const admitted = await audio.admit(ACCOUNT, capture.id, WAV, "audio/wav");
    await expect(service.cancel(ACCOUNT, capture.id, "0")).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
    const canceled = await service.cancel(ACCOUNT, capture.id, capture.revision);
    expect(canceled.state).toBe("canceled");
    expect(audio.hasRawBytes(admitted.audioId)).toBe(false);
  });

  it("hides capture and draft from second account", async () => {
    const { service } = harness();
    const capture = await service.start(ACCOUNT, crypto.randomUUID(), startInput);
    await expect(service.status(OTHER, capture.id)).rejects.toMatchObject({
      code: "CAPTURE_NOT_FOUND",
    });
  });
});
