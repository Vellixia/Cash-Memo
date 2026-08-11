import { createHmac, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import type { SupportedAudioMediaType } from "./provider-ports.js";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 60_000;

type SupportedAudioCodec = "aac" | "mp3" | "opus" | "pcm";
type AudioDeletionReason = "canceled" | "expired" | "failure" | "task_terminated" | "transcribed";

export interface AudioInspection {
  readonly codec: SupportedAudioCodec;
  readonly detectedMediaType: SupportedAudioMediaType;
  readonly measuredDurationMs: number;
}

export interface AudioInspectorPort {
  inspect(bytes: Uint8Array, declaredMediaType: SupportedAudioMediaType): Promise<AudioInspection>;
}

export interface TemporaryAudioView {
  readonly audioId: string;
  readonly captureId: string;
  readonly declaredMediaType: SupportedAudioMediaType;
  readonly expiresAt: string;
  readonly measuredDurationMs: number;
}

interface StoredAudio {
  readonly accountId: string;
  readonly captureId: string;
  readonly expiresAt: number;
  readonly mediaType: SupportedAudioMediaType;
}

export class AudioAdmissionError extends Error {
  constructor(
    readonly code:
      | "AUDIO_CODEC_INVALID"
      | "AUDIO_DURATION_INVALID"
      | "AUDIO_EXPIRED"
      | "AUDIO_MEDIA_TYPE_MISMATCH"
      | "AUDIO_NOT_FOUND"
      | "AUDIO_SIZE_INVALID",
  ) {
    super(code);
    this.name = "AudioAdmissionError";
  }
}

export interface EphemeralAudioStore {
  delete(id: string): Promise<void>;
  get(id: string): Uint8Array | null;
  put(id: string, bytes: Uint8Array): Promise<void>;
}

export class MemoryEphemeralAudioStore implements EphemeralAudioStore {
  private readonly values = new Map<string, Uint8Array>();

  delete(id: string): Promise<void> {
    const bytes = this.values.get(id);
    if (bytes !== undefined) bytes.fill(0);
    this.values.delete(id);
    return Promise.resolve();
  }

  get(id: string): Uint8Array | null {
    return this.values.get(id) ?? null;
  }

  put(id: string, bytes: Uint8Array): Promise<void> {
    this.values.set(id, Uint8Array.from(bytes));
    return Promise.resolve();
  }
}

function magicMatches(bytes: Uint8Array, mediaType: SupportedAudioMediaType): boolean {
  const ascii = (start: number, end: number) =>
    Buffer.from(bytes.slice(start, end)).toString("ascii");
  switch (mediaType) {
    case "audio/webm":
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
    case "audio/mp4":
      return ascii(4, 8) === "ftyp";
    case "audio/wav":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case "audio/mpeg":
      return ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0);
  }
}

function codecAllowed(mediaType: SupportedAudioMediaType, codec: SupportedAudioCodec): boolean {
  switch (mediaType) {
    case "audio/webm":
    case "audio/ogg":
      return codec === "opus";
    case "audio/mp4":
      return codec === "aac";
    case "audio/wav":
      return codec === "pcm";
    case "audio/mpeg":
      return codec === "mp3";
  }
}

export class TemporaryAudioService {
  private readonly index = new Map<string, StoredAudio>();
  private readonly inspector: AudioInspectorPort;
  private readonly now: () => Date;
  private readonly ownerHmacKey: Buffer;
  private readonly pool: Pool;
  private readonly store: EphemeralAudioStore;

  constructor(options: {
    readonly inspector: AudioInspectorPort;
    readonly now?: () => Date;
    readonly ownerHmacKey: Buffer;
    readonly pool: Pool;
    readonly store?: EphemeralAudioStore;
  }) {
    this.inspector = options.inspector;
    this.now = options.now ?? (() => new Date());
    this.ownerHmacKey = options.ownerHmacKey;
    this.pool = options.pool;
    this.store = options.store ?? new MemoryEphemeralAudioStore();
  }

  async admit(
    accountId: string,
    captureId: string,
    bytes: Uint8Array,
    declaredMediaType: SupportedAudioMediaType,
  ): Promise<TemporaryAudioView> {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) {
      throw new AudioAdmissionError("AUDIO_SIZE_INVALID");
    }
    if (!magicMatches(bytes, declaredMediaType)) {
      throw new AudioAdmissionError("AUDIO_MEDIA_TYPE_MISMATCH");
    }
    const inspection = await this.inspector.inspect(bytes, declaredMediaType);
    if (inspection.detectedMediaType !== declaredMediaType) {
      throw new AudioAdmissionError("AUDIO_MEDIA_TYPE_MISMATCH");
    }
    if (!codecAllowed(declaredMediaType, inspection.codec)) {
      throw new AudioAdmissionError("AUDIO_CODEC_INVALID");
    }
    if (
      !Number.isFinite(inspection.measuredDurationMs) ||
      inspection.measuredDurationMs <= 0 ||
      inspection.measuredDurationMs > MAX_AUDIO_DURATION_MS
    ) {
      throw new AudioAdmissionError("AUDIO_DURATION_INVALID");
    }

    const audioId = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1_000);
    await this.store.put(audioId, bytes);
    try {
      await withAccountTransaction(this.pool, accountId, async (transaction) => {
        await transaction.query(
          `INSERT INTO temporary_audio_metadata (
             id, user_id, capture_id, owner_instance_hmac, storage_kind, state,
             byte_size, declared_media_type, created_at, expires_at, revision
           ) VALUES ($1, $2, $3, $4, 'memory', 'ready', $5, $6, $7, $8, 1)`,
          [
            audioId,
            accountId,
            captureId,
            createHmac("sha256", this.ownerHmacKey).update(audioId).digest(),
            bytes.byteLength,
            declaredMediaType,
            createdAt,
            expiresAt,
          ],
        );
      });
    } catch (error) {
      await this.store.delete(audioId);
      throw error;
    }
    this.index.set(audioId, {
      accountId,
      captureId,
      expiresAt: expiresAt.getTime(),
      mediaType: declaredMediaType,
    });
    return Object.freeze({
      audioId,
      captureId,
      declaredMediaType,
      expiresAt: expiresAt.toISOString(),
      measuredDurationMs: inspection.measuredDurationMs,
    });
  }

  async process<T>(
    accountId: string,
    audioId: string,
    processor: (audio: Uint8Array, mediaType: SupportedAudioMediaType) => Promise<T>,
  ): Promise<T> {
    const entry = this.ownedEntry(accountId, audioId);
    if (entry.expiresAt <= this.now().getTime()) {
      await this.delete(accountId, audioId, "expired");
      throw new AudioAdmissionError("AUDIO_EXPIRED");
    }
    const bytes = this.store.get(audioId);
    if (bytes === null) throw new AudioAdmissionError("AUDIO_NOT_FOUND");
    await this.markState(accountId, audioId, "transcribing");
    let succeeded = false;
    try {
      const result = await processor(bytes, entry.mediaType);
      succeeded = true;
      return result;
    } finally {
      await this.delete(accountId, audioId, succeeded ? "transcribed" : "failure");
    }
  }

  async delete(accountId: string, audioId: string, reason: AudioDeletionReason): Promise<void> {
    const entry = this.index.get(audioId);
    if (entry === undefined) return;
    if (entry.accountId !== accountId) throw new AudioAdmissionError("AUDIO_NOT_FOUND");
    await this.markState(accountId, audioId, "deleting");
    try {
      await this.store.delete(audioId);
      this.index.delete(audioId);
      await withAccountTransaction(this.pool, accountId, async (transaction) => {
        await transaction.query(
          `UPDATE temporary_audio_metadata
             SET state = $3::audio_state, deleted_at = $4, deletion_reason = $5,
                 revision = revision + 1
           WHERE id = $1 AND user_id = $2`,
          [audioId, accountId, reason === "expired" ? "expired" : "deleted", this.now(), reason],
        );
      });
    } catch (error) {
      await this.markState(accountId, audioId, "delete_failed");
      throw error;
    }
  }

  hasRawBytes(audioId: string): boolean {
    return this.store.get(audioId) !== null;
  }

  entries(): readonly {
    accountId: string;
    audioId: string;
    captureId: string;
    expiresAt: number;
  }[] {
    return [...this.index.entries()].map(([audioId, entry]) => ({
      accountId: entry.accountId,
      audioId,
      captureId: entry.captureId,
      expiresAt: entry.expiresAt,
    }));
  }

  async terminate(): Promise<void> {
    await Promise.all(
      this.entries().map(async (entry) =>
        this.delete(entry.accountId, entry.audioId, "task_terminated"),
      ),
    );
  }

  private ownedEntry(accountId: string, audioId: string): StoredAudio {
    const entry = this.index.get(audioId);
    if (entry?.accountId !== accountId) {
      throw new AudioAdmissionError("AUDIO_NOT_FOUND");
    }
    return entry;
  }

  private async markState(
    accountId: string,
    audioId: string,
    state: "delete_failed" | "deleting" | "transcribing",
  ): Promise<void> {
    await withAccountTransaction(this.pool, accountId, async (transaction) => {
      await transaction.query(
        `UPDATE temporary_audio_metadata
           SET state = $3::audio_state, revision = revision + 1
         WHERE id = $1 AND user_id = $2`,
        [audioId, accountId, state],
      );
    });
  }
}

export { MAX_AUDIO_BYTES, MAX_AUDIO_DURATION_MS, magicMatches };
