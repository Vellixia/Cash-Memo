export class InvalidLifecycleTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";

  constructor(
    readonly lifecycle: string,
    readonly currentState: string,
    readonly event: string,
  ) {
    super(`Invalid ${lifecycle} transition from ${currentState} using ${event}`);
    this.name = "InvalidLifecycleTransitionError";
  }
}

function invalid(lifecycle: string, currentState: string, event: string): never {
  throw new InvalidLifecycleTransitionError(lifecycle, currentState, event);
}

export const moneyMemoLifecycleStates = [
  "active",
  "archived",
  "recently_deleted",
  "purging",
  "absent",
] as const;
export const moneyMemoLifecycleEvents = [
  "archive",
  "activate",
  "delete",
  "restore",
  "request_purge",
  "expire",
  "hard_delete",
] as const;

interface MoneyMemoOrdinaryLifecycle {
  readonly state: "active" | "archived";
}
interface MoneyMemoRecentlyDeletedLifecycle {
  readonly priorState: MoneyMemoOrdinaryLifecycle["state"];
  readonly state: "recently_deleted";
}
interface MoneyMemoTerminalLifecycle {
  readonly state: "purging" | "absent";
}

export type MoneyMemoLifecycle =
  MoneyMemoOrdinaryLifecycle | MoneyMemoRecentlyDeletedLifecycle | MoneyMemoTerminalLifecycle;
export type MoneyMemoLifecycleEvent = (typeof moneyMemoLifecycleEvents)[number];

export function transitionMoneyMemoLifecycle(
  current: MoneyMemoLifecycle,
  event: MoneyMemoLifecycleEvent,
): MoneyMemoLifecycle {
  if (current.state === "active") {
    if (event === "archive") return { state: "archived" };
    if (event === "delete") return { priorState: "active", state: "recently_deleted" };
  }
  if (current.state === "archived") {
    if (event === "activate") return { state: "active" };
    if (event === "delete") return { priorState: "archived", state: "recently_deleted" };
  }
  if (current.state === "recently_deleted") {
    if (event === "restore") return { state: current.priorState };
    if (event === "request_purge" || event === "expire") return { state: "purging" };
  }
  if (current.state === "purging" && event === "hard_delete") return { state: "absent" };
  return invalid("money_memo", current.state, event);
}

export const composeDraftStates = [
  "editing",
  "processing",
  "reviewable",
  "blocked",
  "failed_recoverable",
  "absent",
] as const;
export const composeDraftEvents = [
  "start_processing",
  "make_reviewable",
  "block",
  "fail_recoverable",
  "edit",
  "discard",
  "expire",
] as const;

export interface ComposeDraftLifecycle {
  readonly state: (typeof composeDraftStates)[number];
}
export type ComposeDraftEvent = (typeof composeDraftEvents)[number];

export function transitionComposeDraft(
  current: ComposeDraftLifecycle,
  event: ComposeDraftEvent,
): ComposeDraftLifecycle {
  if (event === "discard" || event === "expire") {
    if (current.state !== "absent") return { state: "absent" };
  }
  if (current.state === "editing") {
    if (event === "start_processing") return { state: "processing" };
    if (event === "block") return { state: "blocked" };
    if (event === "fail_recoverable") return { state: "failed_recoverable" };
  }
  if (current.state === "processing") {
    if (event === "make_reviewable") return { state: "reviewable" };
    if (event === "block") return { state: "blocked" };
    if (event === "fail_recoverable") return { state: "failed_recoverable" };
    if (event === "edit") return { state: "editing" };
  }
  if (current.state === "reviewable") {
    if (event === "edit") return { state: "editing" };
    if (event === "block") return { state: "blocked" };
    if (event === "fail_recoverable") return { state: "failed_recoverable" };
  }
  if (current.state === "blocked" && event === "edit") return { state: "editing" };
  if (current.state === "failed_recoverable") {
    if (event === "edit") return { state: "editing" };
    if (event === "start_processing") return { state: "processing" };
  }
  return invalid("compose_draft", current.state, event);
}

export const assistedCaptureStates = [
  "editing",
  "recording",
  "audio_ready",
  "transcribing",
  "transcript_review",
  "extracting",
  "draft_review",
  "correction_required",
  "failed_recoverable",
  "cleanup_scheduled",
] as const;
export const assistedCaptureEvents = [
  "start_typed_extraction",
  "start_voice",
  "finish_recording",
  "start_transcription",
  "transcription_succeeded",
  "transcription_failed",
  "start_extraction",
  "extraction_valid",
  "extraction_ambiguous",
  "extraction_failed",
  "edit",
  "discard",
] as const;

export interface AssistedCaptureLifecycle {
  readonly state: (typeof assistedCaptureStates)[number];
}
export type AssistedCaptureEvent = (typeof assistedCaptureEvents)[number];

export function transitionAssistedCapture(
  current: AssistedCaptureLifecycle,
  event: AssistedCaptureEvent,
): AssistedCaptureLifecycle {
  if (event === "discard" && current.state !== "cleanup_scheduled") {
    return { state: "cleanup_scheduled" };
  }
  if (current.state === "editing") {
    if (event === "start_typed_extraction") return { state: "extracting" };
    if (event === "start_voice") return { state: "recording" };
  }
  if (current.state === "recording" && event === "finish_recording") {
    return { state: "audio_ready" };
  }
  if (current.state === "audio_ready" && event === "start_transcription") {
    return { state: "transcribing" };
  }
  if (current.state === "transcribing") {
    if (event === "transcription_succeeded") return { state: "transcript_review" };
    if (event === "transcription_failed") return { state: "failed_recoverable" };
  }
  if (current.state === "transcript_review") {
    if (event === "start_extraction") return { state: "extracting" };
    if (event === "edit") return { state: "editing" };
  }
  if (current.state === "extracting") {
    if (event === "extraction_valid") return { state: "draft_review" };
    if (event === "extraction_ambiguous") return { state: "correction_required" };
    if (event === "extraction_failed") return { state: "failed_recoverable" };
  }
  if (
    (current.state === "draft_review" ||
      current.state === "correction_required" ||
      current.state === "failed_recoverable") &&
    event === "edit"
  ) {
    return { state: "editing" };
  }
  return invalid("assisted_capture", current.state, event);
}

export const audioLifecycleStates = [
  "receiving",
  "ready",
  "transcribing",
  "deleting",
  "deleted",
  "expired",
  "delete_failed",
] as const;
export const audioLifecycleEvents = [
  "finish_receiving",
  "start_transcription",
  "request_delete",
  "deletion_verified",
  "expiry_verified",
  "deletion_failed",
] as const;

export interface AudioLifecycle {
  readonly state: (typeof audioLifecycleStates)[number];
}
export type AudioLifecycleEvent = (typeof audioLifecycleEvents)[number];

export function transitionAudioLifecycle(
  current: AudioLifecycle,
  event: AudioLifecycleEvent,
): AudioLifecycle {
  if (
    event === "request_delete" &&
    (current.state === "receiving" ||
      current.state === "ready" ||
      current.state === "transcribing" ||
      current.state === "delete_failed")
  ) {
    return { state: "deleting" };
  }
  if (current.state === "receiving" && event === "finish_receiving") {
    return { state: "ready" };
  }
  if (current.state === "ready" && event === "start_transcription") {
    return { state: "transcribing" };
  }
  if (current.state === "deleting") {
    if (event === "deletion_verified") return { state: "deleted" };
    if (event === "expiry_verified") return { state: "expired" };
    if (event === "deletion_failed") return { state: "delete_failed" };
  }
  return invalid("temporary_audio", current.state, event);
}

export const exportLifecycleStates = [
  "queued",
  "running",
  "ready",
  "failed",
  "canceled",
  "expired",
  "deleting",
  "deleted",
] as const;
export const exportLifecycleEvents = [
  "start",
  "publish_verified",
  "fail",
  "cancel",
  "expire",
  "request_delete",
  "deletion_verified",
  "download",
] as const;

export interface ExportLifecycle {
  readonly state: (typeof exportLifecycleStates)[number];
}
export type ExportLifecycleEvent = (typeof exportLifecycleEvents)[number];

export function transitionExportLifecycle(
  current: ExportLifecycle,
  event: ExportLifecycleEvent,
): ExportLifecycle {
  if (current.state === "queued") {
    if (event === "start") return { state: "running" };
    if (event === "cancel") return { state: "canceled" };
  }
  if (current.state === "running") {
    if (event === "publish_verified") return { state: "ready" };
    if (event === "fail") return { state: "failed" };
    if (event === "cancel") return { state: "canceled" };
  }
  if (current.state === "ready") {
    if (event === "download") return current;
    if (event === "expire") return { state: "expired" };
    if (event === "cancel") return { state: "canceled" };
  }
  if (
    (current.state === "expired" || current.state === "canceled" || current.state === "failed") &&
    event === "request_delete"
  ) {
    return { state: "deleting" };
  }
  if (current.state === "deleting" && event === "deletion_verified") {
    return { state: "deleted" };
  }
  return invalid("export_job", current.state, event);
}

export const accountDeletionStates = [
  "active",
  "grace",
  "purging",
  "live_purged",
  "provider_pending",
  "complete",
  "failed",
] as const;
export const accountDeletionEvents = [
  "request_deletion",
  "cancel",
  "begin_purge",
  "live_purge_succeeded",
  "live_purge_failed",
  "providers_required",
  "providers_not_required",
  "provider_deletion_complete",
  "provider_deletion_failed",
  "retry_purge",
] as const;

export interface AccountDeletionLifecycle {
  readonly state: (typeof accountDeletionStates)[number];
}
export type AccountDeletionEvent = (typeof accountDeletionEvents)[number];

export function transitionAccountDeletion(
  current: AccountDeletionLifecycle,
  event: AccountDeletionEvent,
): AccountDeletionLifecycle {
  if (current.state === "active" && event === "request_deletion") return { state: "grace" };
  if (current.state === "grace") {
    if (event === "cancel") return { state: "active" };
    if (event === "begin_purge") return { state: "purging" };
  }
  if (current.state === "purging") {
    if (event === "live_purge_succeeded") return { state: "live_purged" };
    if (event === "live_purge_failed") return { state: "failed" };
  }
  if (current.state === "live_purged") {
    if (event === "providers_required") return { state: "provider_pending" };
    if (event === "providers_not_required") return { state: "complete" };
  }
  if (current.state === "provider_pending") {
    if (event === "provider_deletion_complete") return { state: "complete" };
    if (event === "provider_deletion_failed") return { state: "failed" };
  }
  if (current.state === "failed" && event === "retry_purge") return { state: "purging" };
  return invalid("account_deletion", current.state, event);
}
