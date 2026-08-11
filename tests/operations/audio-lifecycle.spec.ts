/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MemoryEphemeralAudioStore,
  TemporaryAudioService,
  type EphemeralAudioStore,
} from "../../apps/server/src/modules/assisted-capture/temporary-audio.service.js";
import { AudioSweeper } from "../../apps/server/src/modules/operations/audio-sweeper.js";
import { applyMigrations } from "../../apps/server/tests/integration/support/postgres-migrations.js";
import {
  startTestEnvironment,
  type TestEnvironment,
} from "../../apps/server/tests/integration/support/test-environment.js";

const ACCOUNT = "00000000-0000-4000-8000-000000000148";
const DRAFT = "10000000-0000-4000-8000-000000000148";
const CAPTURE = "20000000-0000-4000-8000-000000000148";
const WAV = Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE"), 7]);

describe("temporary audio lifecycle operations", { concurrent: false }, () => {
  let environment: TestEnvironment;
  let admin: Pool;
  let runtime: Pool;
  let now = new Date("2026-08-11T00:00:00Z");

  beforeAll(async () => {
    environment = await startTestEnvironment({ services: ["postgres"] });
    if (environment.postgres === undefined) throw new Error("PostgreSQL missing");
    admin = new Pool({ connectionString: environment.postgres.connectionUri });
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO users (id, name, email, email_verified, status) VALUES ($1, 'Cashmemo account', 'audio-ops@cashmemo.test', true, 'active')`,
      [ACCOUNT],
    );
    runtime = new Pool({
      connectionString: environment.postgres.connectionUri,
      options: "-c role=cashmemo_runtime",
    });
  }, 120_000);

  beforeEach(async () => {
    now = new Date("2026-08-11T00:00:00Z");
    await admin.query("DELETE FROM temporary_audio_metadata");
    await admin.query("DELETE FROM assisted_captures");
    await admin.query("DELETE FROM compose_drafts");
    await admin.query(
      `INSERT INTO compose_drafts (id, user_id, origin, source_text, source_completeness, candidate_fields, field_provenance, capture_started_at, capture_timezone, status, last_activity_at, expires_at) VALUES ($1, $2, 'voice', NULL, 'not_applicable', '{}', '[]', now(), 'UTC', 'editing', now(), now() + interval '7 days')`,
      [DRAFT, ACCOUNT],
    );
    await admin.query(
      `INSERT INTO assisted_captures (id, user_id, draft_id, mode, state, stt_consent_version, ai_consent_version, capture_started_at) VALUES ($1, $2, $3, 'voice', 'recording', 'stt-consent-v1', 'transcript-consent-v1', now())`,
      [CAPTURE, ACCOUNT, DRAFT],
    );
  });

  afterAll(async () => {
    await runtime.end();
    await admin.end();
    await environment.stop();
  });

  function audio(store: EphemeralAudioStore = new MemoryEphemeralAudioStore()) {
    return new TemporaryAudioService({
      inspector: {
        inspect: async () => ({
          codec: "pcm",
          detectedMediaType: "audio/wav",
          measuredDurationMs: 1_000,
        }),
      },
      now: () => now,
      ownerHmacKey: Buffer.from("synthetic-audio-owner-hmac-key-32"),
      pool: runtime,
      store,
    });
  }

  it("deletes raw bytes after successful transcription", async () => {
    const service = audio();
    const admitted = await service.admit(ACCOUNT, CAPTURE, WAV, "audio/wav");
    await service.process(ACCOUNT, admitted.audioId, async () => "ok");
    expect(service.hasRawBytes(admitted.audioId)).toBe(false);
  });

  it("deletes raw bytes when provider processing throws", async () => {
    const service = audio();
    const admitted = await service.admit(ACCOUNT, CAPTURE, WAV, "audio/wav");
    await expect(
      service.process(ACCOUNT, admitted.audioId, async () => {
        throw new Error("provider failure");
      }),
    ).rejects.toThrow();
    expect(service.hasRawBytes(admitted.audioId)).toBe(false);
  });

  it("deletes on cancellation and keeps only content-free metadata", async () => {
    const service = audio();
    const admitted = await service.admit(ACCOUNT, CAPTURE, WAV, "audio/wav");
    await service.delete(ACCOUNT, admitted.audioId, "canceled");
    const row = (
      await admin.query(
        `SELECT state, deletion_reason, byte_size FROM temporary_audio_metadata WHERE id = $1`,
        [admitted.audioId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      state: "deleted",
      deletion_reason: "canceled",
      byte_size: WAV.byteLength,
    });
    expect(Object.keys(row)).not.toContain("audio");
  });

  it("sweeps expiry and startup leftovers", async () => {
    const service = audio();
    const admitted = await service.admit(ACCOUNT, CAPTURE, WAV, "audio/wav");
    now = new Date("2026-08-11T01:00:01Z");
    expect(await new AudioSweeper({ audio: service, now: () => now }).startupCleanup()).toEqual({
      cleanupFailures: 0,
      removed: 1,
    });
    expect(service.hasRawBytes(admitted.audioId)).toBe(false);
  });

  it("runs the owner sweeper on a one-minute interval", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    try {
      const service = audio();
      const sweeper = new AudioSweeper({ audio: service, now: () => now });
      const stop = sweeper.start();
      expect(interval).toHaveBeenCalledWith(expect.any(Function), 60_000);
      stop();
    } finally {
      interval.mockRestore();
    }
  });

  it("deletes all owned audio on task termination", async () => {
    const service = audio();
    const admitted = await service.admit(ACCOUNT, CAPTURE, WAV, "audio/wav");
    await new AudioSweeper({ audio: service }).terminate();
    expect(service.hasRawBytes(admitted.audioId)).toBe(false);
  });

  it("alerts on deletion failure and succeeds on retry", async () => {
    class FailOnceStore extends MemoryEphemeralAudioStore {
      failures = 1;
      override async delete(id: string) {
        if (this.failures-- > 0) throw new Error("synthetic delete failure");
        await super.delete(id);
      }
    }
    const store = new FailOnceStore();
    const service = audio(store);
    const admitted = await service.admit(ACCOUNT, CAPTURE, WAV, "audio/wav");
    now = new Date("2026-08-11T01:00:01Z");
    const alerts: string[] = [];
    const sweeper = new AudioSweeper({
      alert: (code) => alerts.push(code),
      audio: service,
      now: () => now,
    });
    expect(await sweeper.runOnce()).toEqual({ cleanupFailures: 1, removed: 0 });
    expect(alerts).toEqual(["AUDIO_DELETE_FAILED"]);
    expect(await sweeper.runOnce()).toEqual({ cleanupFailures: 0, removed: 1 });
    expect(service.hasRawBytes(admitted.audioId)).toBe(false);
  });
});
