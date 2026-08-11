/* eslint-disable @typescript-eslint/require-await */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AudioAdmissionError,
  MAX_AUDIO_BYTES,
  TemporaryAudioService,
  type AudioInspection,
  type AudioInspectorPort,
} from "../../src/modules/assisted-capture/temporary-audio.service.js";
import type { SupportedAudioMediaType } from "../../src/modules/assisted-capture/provider-ports.js";
import { applyMigrations } from "./support/postgres-migrations.js";
import { startTestEnvironment, type TestEnvironment } from "./support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000133";
const OTHER = "00000000-0000-4000-8000-000000000134";
const DRAFT = "40000000-0000-4000-8000-000000000133";
const CAPTURE = "50000000-0000-4000-8000-000000000133";

const signatures: Record<SupportedAudioMediaType, number[]> = {
  "audio/webm": [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0],
  "audio/ogg": [...Buffer.from("OggS"), 0, 0, 0, 0],
  "audio/mp4": [0, 0, 0, 16, ...Buffer.from("ftyp"), 0, 0, 0, 0],
  "audio/wav": [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")],
  "audio/mpeg": [...Buffer.from("ID3"), 0, 0, 0, 0, 0],
};
const codecs = {
  "audio/webm": "opus",
  "audio/ogg": "opus",
  "audio/mp4": "aac",
  "audio/wav": "pcm",
  "audio/mpeg": "mp3",
} as const;

class Inspector implements AudioInspectorPort {
  duration = 1_000;
  codecOverride: AudioInspection["codec"] | null = null;

  inspect(
    _bytes: Uint8Array,
    declaredMediaType: SupportedAudioMediaType,
  ): Promise<AudioInspection> {
    return Promise.resolve({
      codec: this.codecOverride ?? codecs[declaredMediaType],
      detectedMediaType: declaredMediaType,
      measuredDurationMs: this.duration,
    });
  }
}

describe("temporary audio admission", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let adminPool: Pool;
  let runtimePool: Pool;
  let inspector: Inspector;
  let nowMs: number;
  let audio: TemporaryAudioService;

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL test service missing");
    adminPool = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(adminPool);
    await adminPool.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES
       ($1, 'Cashmemo account', 'audio-owner@cashmemo.test', true, 'active'),
       ($2, 'Cashmemo account', 'audio-other@cashmemo.test', true, 'active')`,
      [ACCOUNT, OTHER],
    );
    await adminPool.query(
      `INSERT INTO compose_drafts (
         id, user_id, origin, source_completeness, candidate_fields, field_provenance,
         capture_started_at, capture_timezone, status, last_activity_at, expires_at
       ) VALUES (
         $1, $2, 'voice', 'not_applicable', '{}'::jsonb, '[]'::jsonb,
         '2026-08-11T10:00:00Z', 'UTC', 'editing', '2026-08-11T10:00:00Z',
         '2026-08-18T10:00:00Z'
       )`,
      [DRAFT, ACCOUNT],
    );
    await adminPool.query(
      `INSERT INTO assisted_captures (
         id, user_id, draft_id, mode, state, stt_consent_version, ai_consent_version,
         capture_started_at
       ) VALUES ($1, $2, $3, 'voice', 'recording', 'stt-v1', 'ai-v1', '2026-08-11T10:00:00Z')`,
      [CAPTURE, ACCOUNT, DRAFT],
    );
    runtimePool = new Pool({
      connectionString: environment.postgres.connectionUri,
      max: 4,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  afterAll(async () => {
    await runtimePool.end();
    await adminPool.end();
    await environment.stop();
  });

  function resetService() {
    inspector = new Inspector();
    nowMs = Date.parse("2026-08-11T10:00:00Z");
    audio = new TemporaryAudioService({
      inspector,
      now: () => new Date(nowMs),
      ownerHmacKey: Buffer.from("synthetic-owner-key-32-bytes-long"),
      pool: runtimePool,
    });
  }

  it.each(Object.keys(signatures) as SupportedAudioMediaType[])(
    "accepts supported %s only after magic, codec, and measured-duration checks",
    async (mediaType) => {
      resetService();
      const admitted = await audio.admit(
        ACCOUNT,
        CAPTURE,
        Uint8Array.from(signatures[mediaType]),
        mediaType,
      );
      expect(admitted.measuredDurationMs).toBe(1_000);
      expect(audio.hasRawBytes(admitted.audioId)).toBe(true);
      await audio.delete(ACCOUNT, admitted.audioId, "canceled");
    },
  );

  it("rejects spoofed MIME before inspection or persistence", async () => {
    resetService();
    await expect(
      audio.admit(ACCOUNT, CAPTURE, Uint8Array.from(signatures["audio/ogg"]), "audio/webm"),
    ).rejects.toMatchObject({ code: "AUDIO_MEDIA_TYPE_MISMATCH" });
  });

  it("rejects malformed media and codec mismatch", async () => {
    resetService();
    await expect(
      audio.admit(ACCOUNT, CAPTURE, new Uint8Array([1, 2, 3]), "audio/wav"),
    ).rejects.toBeInstanceOf(AudioAdmissionError);
    inspector.codecOverride = "aac";
    await expect(
      audio.admit(ACCOUNT, CAPTURE, Uint8Array.from(signatures["audio/wav"]), "audio/wav"),
    ).rejects.toMatchObject({ code: "AUDIO_CODEC_INVALID" });
  });

  it("enforces maximum payload size", async () => {
    resetService();
    const oversized = new Uint8Array(MAX_AUDIO_BYTES + 1);
    oversized.set(signatures["audio/wav"]);
    await expect(audio.admit(ACCOUNT, CAPTURE, oversized, "audio/wav")).rejects.toMatchObject({
      code: "AUDIO_SIZE_INVALID",
    });
  });

  it("uses server-measured duration and accepts exactly 60 seconds", async () => {
    resetService();
    inspector.duration = 60_000;
    const admitted = await audio.admit(
      ACCOUNT,
      CAPTURE,
      Uint8Array.from(signatures["audio/wav"]),
      "audio/wav",
    );
    expect(admitted.measuredDurationMs).toBe(60_000);
    await audio.delete(ACCOUNT, admitted.audioId, "canceled");
  });

  it("rejects measured duration beyond 60 seconds independently of provider timeout", async () => {
    resetService();
    inspector.duration = 60_001;
    await expect(
      audio.admit(ACCOUNT, CAPTURE, Uint8Array.from(signatures["audio/wav"]), "audio/wav"),
    ).rejects.toMatchObject({ code: "AUDIO_DURATION_INVALID" });
  });

  it("deletes raw bytes in finally after success and failure", async () => {
    resetService();
    const first = await audio.admit(
      ACCOUNT,
      CAPTURE,
      Uint8Array.from(signatures["audio/wav"]),
      "audio/wav",
    );
    await expect(audio.process(ACCOUNT, first.audioId, async () => "ok")).resolves.toBe("ok");
    expect(audio.hasRawBytes(first.audioId)).toBe(false);
    const second = await audio.admit(
      ACCOUNT,
      CAPTURE,
      Uint8Array.from(signatures["audio/wav"]),
      "audio/wav",
    );
    await expect(
      audio.process(ACCOUNT, second.audioId, async () => {
        throw new Error("synthetic failure");
      }),
    ).rejects.toThrow("synthetic failure");
    expect(audio.hasRawBytes(second.audioId)).toBe(false);
  });

  it("refuses expired audio after deleting its bytes", async () => {
    resetService();
    const admitted = await audio.admit(
      ACCOUNT,
      CAPTURE,
      Uint8Array.from(signatures["audio/wav"]),
      "audio/wav",
    );
    nowMs += 60 * 60 * 1_000;
    await expect(audio.process(ACCOUNT, admitted.audioId, async () => "no")).rejects.toMatchObject({
      code: "AUDIO_EXPIRED",
    });
    expect(audio.hasRawBytes(admitted.audioId)).toBe(false);
  });

  it("does not expose another account's temporary bytes", async () => {
    resetService();
    const admitted = await audio.admit(
      ACCOUNT,
      CAPTURE,
      Uint8Array.from(signatures["audio/wav"]),
      "audio/wav",
    );
    await expect(audio.process(OTHER, admitted.audioId, async () => "leak")).rejects.toMatchObject({
      code: "AUDIO_NOT_FOUND",
    });
    await audio.delete(ACCOUNT, admitted.audioId, "canceled");
  });
});
