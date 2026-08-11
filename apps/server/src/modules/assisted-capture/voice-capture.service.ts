import type { Pool } from "pg";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import { createDraft } from "../draft/draft.service.js";
import { requireProviderConsent, requireVoiceLimitationDisclosure } from "./consent-policy.js";
import type { SttPort, SupportedAudioMediaType } from "./provider-ports.js";
import { type TemporaryAudioService } from "./temporary-audio.service.js";
import { TranscriptBoundaryError, type TranscriptService } from "./transcript.service.js";

export type VoiceCaptureState =
  | "audio_ready"
  | "canceled"
  | "correction_required"
  | "draft_review"
  | "failed_recoverable"
  | "recording"
  | "transcribing"
  | "transcript_review";

export interface VoiceCaptureView {
  readonly audioExpiresAt: string | null;
  readonly authoritative: false;
  readonly capability: {
    readonly ai: "available" | "degraded" | "unavailable";
    readonly stt: "available" | "degraded" | "unavailable";
  };
  readonly createdAt: string;
  readonly draftId: string | null;
  readonly errorCode:
    | "AI_INVALID_OUTPUT"
    | "AI_UNAVAILABLE"
    | "AUDIO_INVALID"
    | "PRIVACY_BOUNDARY_BLOCKED"
    | "STT_TIMEOUT"
    | "STT_UNAVAILABLE"
    | null;
  readonly id: string;
  readonly revision: string;
  readonly state: VoiceCaptureState;
}

export class VoiceCaptureError extends Error {
  constructor(
    readonly code:
      "CAPTURE_NOT_FOUND" | "PROVIDER_CONSENT_REQUIRED" | "REVISION_CONFLICT" | "STATE_CONFLICT",
  ) {
    super(code);
    this.name = "VoiceCaptureError";
  }
}

interface CaptureRow {
  readonly ai_consent_version: string | null;
  readonly capture_started_at: Date | string;
  readonly capture_timezone: string;
  readonly created_at: Date | string;
  readonly draft_id: string;
  readonly id: string;
  readonly last_error_code: string | null;
  readonly revision: string;
  readonly state: string;
  readonly stt_consent_version: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function errorCode(value: string | null): VoiceCaptureView["errorCode"] {
  switch (value) {
    case null:
      return null;
    case "stt_unavailable":
      return "STT_UNAVAILABLE";
    case "extraction_unavailable":
      return "AI_UNAVAILABLE";
    case "invalid_output":
    case "ambiguous_output":
      return "AI_INVALID_OUTPUT";
    case "audio_invalid":
      return "AUDIO_INVALID";
    case "privacy_blocked":
      return "PRIVACY_BOUNDARY_BLOCKED";
    default:
      return null;
  }
}

function view(row: CaptureRow, audioExpiresAt: string | null = null): VoiceCaptureView {
  const mappedError = errorCode(row.last_error_code);
  return Object.freeze({
    audioExpiresAt,
    authoritative: false,
    capability: Object.freeze({
      ai: mappedError === "AI_UNAVAILABLE" ? "unavailable" : "available",
      stt: mappedError === "STT_UNAVAILABLE" ? "unavailable" : "available",
    }),
    createdAt: iso(row.created_at),
    draftId: row.draft_id,
    errorCode: mappedError,
    id: row.id,
    revision: row.revision,
    state: (row.state === "cleanup_scheduled" ? "canceled" : row.state) as VoiceCaptureState,
  });
}

export class VoiceCaptureService {
  private readonly startReplay = new Map<string, VoiceCaptureView>();
  private readonly uploadReplay = new Map<string, VoiceCaptureView>();

  constructor(
    private readonly options: {
      readonly audio: TemporaryAudioService;
      readonly pool: Pool;
      readonly stt: SttPort;
      readonly transcript: TranscriptService;
    },
  ) {}

  async start(
    accountId: string,
    idempotencyKey: string,
    input: {
      readonly aiConsent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION";
      readonly captureStartedAt: string;
      readonly captureTimezone: string;
      readonly detectorLimitationDisclosed: true;
      readonly sttConsent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION";
    },
  ): Promise<VoiceCaptureView> {
    requireProviderConsent("voiceStt", input.sttConsent);
    requireProviderConsent("transcriptExtraction", input.aiConsent);
    requireVoiceLimitationDisclosure({
      acknowledged: input.detectorLimitationDisclosed,
      code: "RAW_VOICE_REACHES_STT_BEFORE_TEXT_DETECTION",
    });
    const replayKey = `${accountId}:start:${idempotencyKey}`;
    const replay = this.startReplay.get(replayKey);
    if (replay !== undefined) return replay;
    const draft = await createDraft(this.options.pool, accountId, {
      candidateFields: {},
      captureStartedAt: input.captureStartedAt,
      captureTimezone: input.captureTimezone,
      origin: "voice",
      sourceCompleteness: "not_applicable",
      sourceText: null,
    });
    const row = await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const result = await transaction.query<CaptureRow>(
        `INSERT INTO assisted_captures (
           id, user_id, draft_id, mode, state, stt_consent_version, ai_consent_version,
           capture_started_at, revision
         ) VALUES (
           gen_random_uuid(), $1, $2, 'voice', 'recording', 'stt-consent-v1',
           'transcript-extraction-consent-v1', $3, 1
         ) RETURNING *, $4::text AS capture_timezone`,
        [accountId, draft.id, input.captureStartedAt, input.captureTimezone],
      );
      const capture = result.rows[0];
      if (capture === undefined) throw new VoiceCaptureError("STATE_CONFLICT");
      return capture;
    });
    const result = view(row);
    this.startReplay.set(replayKey, result);
    return result;
  }

  async upload(
    accountId: string,
    captureId: string,
    idempotencyKey: string,
    bytes: Uint8Array,
    mediaType: SupportedAudioMediaType,
  ): Promise<VoiceCaptureView> {
    const replayKey = `${accountId}:upload:${captureId}:${idempotencyKey}`;
    const replay = this.uploadReplay.get(replayKey);
    if (replay !== undefined) return replay;
    const capture = await this.load(accountId, captureId);
    if (capture.state !== "recording") throw new VoiceCaptureError("STATE_CONFLICT");
    const admitted = await this.options.audio.admit(accountId, captureId, bytes, mediaType);
    await this.transition(accountId, captureId, "audio_ready", null);
    await this.transition(accountId, captureId, "transcribing", null);
    let sttResult;
    try {
      sttResult = await this.options.audio.process(
        accountId,
        admitted.audioId,
        async (audio, detectedMediaType) =>
          this.options.stt.transcribe({
            attempt: 1,
            audio,
            consent: "SEND_THIS_RECORDING_FOR_TRANSCRIPTION",
            currentRecordingOnly: true,
            deadlineMs: 20_000,
            detectorLimitationDisclosed: true,
            mediaType: detectedMediaType,
          }),
      );
    } catch {
      const failed = await this.transition(
        accountId,
        captureId,
        "failed_recoverable",
        "stt_unavailable",
      );
      const result = view(failed);
      this.uploadReplay.set(replayKey, result);
      return result;
    }
    if (sttResult.state !== "success" && sttResult.state !== "incomplete") {
      const failed = await this.transition(
        accountId,
        captureId,
        "failed_recoverable",
        "stt_unavailable",
      );
      const result = view(failed);
      this.uploadReplay.set(replayKey, result);
      return result;
    }
    await this.transition(accountId, captureId, "transcript_review", null);
    try {
      const processed = await this.options.transcript.process(accountId, {
        captureStartedAt: iso(capture.capture_started_at),
        captureTimezone: capture.capture_timezone,
        completeness: sttResult.completeness,
        consent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION",
        draftId: capture.draft_id,
        transcript: sttResult.transcript,
      });
      const transitioned = await this.transition(accountId, captureId, processed.state, null);
      const result = view(transitioned);
      this.uploadReplay.set(replayKey, result);
      return result;
    } catch (error) {
      const privacyBlocked =
        error instanceof TranscriptBoundaryError && error.code === "PRIVACY_BOUNDARY_BLOCKED";
      const failed = await this.transition(
        accountId,
        captureId,
        "failed_recoverable",
        privacyBlocked ? "privacy_blocked" : "extraction_unavailable",
      );
      const result = view(failed);
      this.uploadReplay.set(replayKey, result);
      return result;
    }
  }

  async status(accountId: string, captureId: string): Promise<VoiceCaptureView> {
    return view(await this.load(accountId, captureId));
  }

  async cancel(
    accountId: string,
    captureId: string,
    expectedRevision: string,
  ): Promise<VoiceCaptureView> {
    const capture = await this.load(accountId, captureId);
    if (capture.revision !== expectedRevision) throw new VoiceCaptureError("REVISION_CONFLICT");
    await Promise.all(
      this.options.audio
        .entries()
        .filter((entry) => entry.accountId === accountId && entry.captureId === captureId)
        .map(async (entry) => this.options.audio.delete(accountId, entry.audioId, "canceled")),
    );
    return view(await this.transition(accountId, captureId, "canceled", null));
  }

  private async load(accountId: string, captureId: string): Promise<CaptureRow> {
    return withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const result = await transaction.query<CaptureRow>(
        `SELECT a.*, d.capture_timezone
           FROM assisted_captures a
           JOIN compose_drafts d ON d.user_id = a.user_id AND d.id = a.draft_id
          WHERE a.id = $1 AND a.user_id = $2`,
        [captureId, accountId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new VoiceCaptureError("CAPTURE_NOT_FOUND");
      return row;
    });
  }

  private async transition(
    accountId: string,
    captureId: string,
    state: VoiceCaptureState,
    lastError: string | null,
  ): Promise<CaptureRow> {
    return withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const result = await transaction.query<CaptureRow>(
        `UPDATE assisted_captures
            SET state = $3::assisted_capture_state,
                last_error_code = $4::capture_error_code,
                updated_at = now(), revision = revision + 1
          WHERE id = $1 AND user_id = $2
          RETURNING *, (
            SELECT capture_timezone FROM compose_drafts
             WHERE compose_drafts.user_id = assisted_captures.user_id
               AND compose_drafts.id = assisted_captures.draft_id
          ) AS capture_timezone`,
        [captureId, accountId, state === "canceled" ? "cleanup_scheduled" : state, lastError],
      );
      const row = result.rows[0];
      if (row === undefined) throw new VoiceCaptureError("CAPTURE_NOT_FOUND");
      return row;
    });
  }
}
