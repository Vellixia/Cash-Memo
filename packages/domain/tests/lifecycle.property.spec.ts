import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  InvalidLifecycleTransitionError,
  accountDeletionEvents,
  accountDeletionStates,
  assistedCaptureEvents,
  assistedCaptureStates,
  audioLifecycleEvents,
  audioLifecycleStates,
  composeDraftEvents,
  composeDraftStates,
  exportLifecycleEvents,
  exportLifecycleStates,
  moneyMemoLifecycleEvents,
  moneyMemoLifecycleStates,
  transitionAccountDeletion,
  transitionAssistedCapture,
  transitionAudioLifecycle,
  transitionComposeDraft,
  transitionExportLifecycle,
  transitionMoneyMemoLifecycle,
  type AccountDeletionLifecycle,
  type AssistedCaptureLifecycle,
  type AudioLifecycle,
  type ComposeDraftLifecycle,
  type ExportLifecycle,
  type MoneyMemoLifecycle,
} from "../src/lifecycle/state-machines.js";

describe("typed lifecycle state machines", () => {
  it("preserves the prior Money Memo state through delete and restore", () => {
    expect(transitionMoneyMemoLifecycle({ state: "active" }, "archive")).toEqual({
      state: "archived",
    });
    expect(transitionMoneyMemoLifecycle({ state: "archived" }, "activate")).toEqual({
      state: "active",
    });
    expect(transitionMoneyMemoLifecycle({ state: "active" }, "delete")).toEqual({
      priorState: "active",
      state: "recently_deleted",
    });
    expect(
      transitionMoneyMemoLifecycle(
        { priorState: "archived", state: "recently_deleted" },
        "restore",
      ),
    ).toEqual({ state: "archived" });
  });

  it("permits purge only from Recently Deleted and makes hard deletion terminal", () => {
    expect(
      transitionMoneyMemoLifecycle(
        { priorState: "active", state: "recently_deleted" },
        "request_purge",
      ),
    ).toEqual({ state: "purging" });
    expect(transitionMoneyMemoLifecycle({ state: "purging" }, "hard_delete")).toEqual({
      state: "absent",
    });
    expect(() => transitionMoneyMemoLifecycle({ state: "active" }, "hard_delete")).toThrow(
      InvalidLifecycleTransitionError,
    );
    expect(() => transitionMoneyMemoLifecycle({ state: "absent" }, "restore")).toThrow(
      InvalidLifecycleTransitionError,
    );
  });

  it("never accepts an arbitrary Money Memo target state", () => {
    const states: readonly MoneyMemoLifecycle[] = [
      { state: "active" },
      { state: "archived" },
      { priorState: "active", state: "recently_deleted" },
      { priorState: "archived", state: "recently_deleted" },
      { state: "purging" },
      { state: "absent" },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...states),
        fc.constantFrom(...moneyMemoLifecycleEvents),
        (state, event) => {
          try {
            const next = transitionMoneyMemoLifecycle(state, event);
            expect(moneyMemoLifecycleStates).toContain(next.state);
            expect(next).not.toHaveProperty("authoritative", false);
          } catch (error: unknown) {
            expect(error).toBeInstanceOf(InvalidLifecycleTransitionError);
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("keeps Compose Draft lifecycle non-authoritative and has no confirm event", () => {
    const start: ComposeDraftLifecycle = { state: "editing" };
    expect(transitionComposeDraft(start, "start_processing")).toEqual({
      state: "processing",
    });
    expect(transitionComposeDraft({ state: "processing" }, "make_reviewable")).toEqual({
      state: "reviewable",
    });
    expect(transitionComposeDraft({ state: "reviewable" }, "edit")).toEqual({
      state: "editing",
    });
    expect(transitionComposeDraft({ state: "blocked" }, "discard")).toEqual({
      state: "absent",
    });
    expect(composeDraftEvents).not.toContain("confirm");
    expect(composeDraftStates).not.toContain("authoritative");
    expect(composeDraftStates).not.toContain("confirmed");
  });

  it("keeps assisted provider capture in draft-only states", () => {
    let capture: AssistedCaptureLifecycle = { state: "editing" };
    capture = transitionAssistedCapture(capture, "start_voice");
    capture = transitionAssistedCapture(capture, "finish_recording");
    capture = transitionAssistedCapture(capture, "start_transcription");
    capture = transitionAssistedCapture(capture, "transcription_succeeded");
    capture = transitionAssistedCapture(capture, "start_extraction");
    capture = transitionAssistedCapture(capture, "extraction_valid");
    expect(capture).toEqual({ state: "draft_review" });
    expect(assistedCaptureEvents).not.toContain("confirm");
    expect(assistedCaptureStates).not.toContain("confirmed");
    expect(assistedCaptureStates).not.toContain("authoritative");
  });

  it("sends retryable provider failures back to visible user editing", () => {
    const failed = transitionAssistedCapture({ state: "transcribing" }, "transcription_failed");
    expect(failed).toEqual({ state: "failed_recoverable" });
    expect(transitionAssistedCapture(failed, "edit")).toEqual({ state: "editing" });
  });

  it("requires audio destruction paths to pass through deleting", () => {
    const starts: readonly AudioLifecycle[] = [
      { state: "receiving" },
      { state: "ready" },
      { state: "transcribing" },
      { state: "delete_failed" },
    ];

    for (const start of starts) {
      expect(transitionAudioLifecycle(start, "request_delete")).toEqual({
        state: "deleting",
      });
    }
    expect(transitionAudioLifecycle({ state: "deleting" }, "deletion_verified")).toEqual({
      state: "deleted",
    });
    expect(transitionAudioLifecycle({ state: "deleting" }, "expiry_verified")).toEqual({
      state: "expired",
    });
    expect(() => transitionAudioLifecycle({ state: "transcribing" }, "deletion_verified")).toThrow(
      InvalidLifecycleTransitionError,
    );
  });

  it("keeps failed audio deletion retryable and deleted audio terminal", () => {
    expect(transitionAudioLifecycle({ state: "deleting" }, "deletion_failed")).toEqual({
      state: "delete_failed",
    });
    expect(transitionAudioLifecycle({ state: "delete_failed" }, "request_delete")).toEqual({
      state: "deleting",
    });
    expect(() => transitionAudioLifecycle({ state: "deleted" }, "start_transcription")).toThrow(
      InvalidLifecycleTransitionError,
    );
  });

  it("does not expose an export until it is ready and makes cleanup terminal", () => {
    let job: ExportLifecycle = { state: "queued" };
    job = transitionExportLifecycle(job, "start");
    job = transitionExportLifecycle(job, "publish_verified");
    expect(job).toEqual({ state: "ready" });
    job = transitionExportLifecycle(job, "expire");
    job = transitionExportLifecycle(job, "request_delete");
    job = transitionExportLifecycle(job, "deletion_verified");
    expect(job).toEqual({ state: "deleted" });
    expect(() => transitionExportLifecycle({ state: "running" }, "download")).toThrow(
      InvalidLifecycleTransitionError,
    );
  });

  it("allows account-deletion cancellation only during grace", () => {
    let account: AccountDeletionLifecycle = { state: "active" };
    account = transitionAccountDeletion(account, "request_deletion");
    expect(account).toEqual({ state: "grace" });
    expect(transitionAccountDeletion(account, "cancel")).toEqual({ state: "active" });

    account = transitionAccountDeletion(account, "begin_purge");
    expect(account).toEqual({ state: "purging" });
    expect(() => transitionAccountDeletion(account, "cancel")).toThrow(
      InvalidLifecycleTransitionError,
    );
  });

  it("never returns an irreversible account lifecycle to active", () => {
    const irreversible: readonly AccountDeletionLifecycle[] = [
      { state: "purging" },
      { state: "live_purged" },
      { state: "provider_pending" },
      { state: "complete" },
      { state: "failed" },
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...irreversible),
        fc.constantFrom(...accountDeletionEvents),
        (state, event) => {
          try {
            const next = transitionAccountDeletion(state, event);
            expect(accountDeletionStates).toContain(next.state);
            expect(next.state).not.toBe("active");
          } catch (error: unknown) {
            expect(error).toBeInstanceOf(InvalidLifecycleTransitionError);
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("rejects all unspecified state/event combinations instead of coercing", () => {
    const assertion = <TState extends { readonly state: string }, TEvent extends string>(
      states: readonly TState[],
      events: readonly TEvent[],
      transition: (state: TState, event: TEvent) => TState,
      knownStates: readonly string[],
    ): void => {
      fc.assert(
        fc.property(fc.constantFrom(...states), fc.constantFrom(...events), (state, event) => {
          try {
            expect(knownStates).toContain(transition(state, event).state);
          } catch (error: unknown) {
            expect(error).toBeInstanceOf(InvalidLifecycleTransitionError);
          }
        }),
        { numRuns: 1_000 },
      );
    };

    assertion<ComposeDraftLifecycle, (typeof composeDraftEvents)[number]>(
      composeDraftStates.map((state) => ({ state })),
      composeDraftEvents,
      transitionComposeDraft,
      composeDraftStates,
    );
    assertion<AssistedCaptureLifecycle, (typeof assistedCaptureEvents)[number]>(
      assistedCaptureStates.map((state) => ({ state })),
      assistedCaptureEvents,
      transitionAssistedCapture,
      assistedCaptureStates,
    );
    assertion<AudioLifecycle, (typeof audioLifecycleEvents)[number]>(
      audioLifecycleStates.map((state) => ({ state })),
      audioLifecycleEvents,
      transitionAudioLifecycle,
      audioLifecycleStates,
    );
    assertion<ExportLifecycle, (typeof exportLifecycleEvents)[number]>(
      exportLifecycleStates.map((state) => ({ state })),
      exportLifecycleEvents,
      transitionExportLifecycle,
      exportLifecycleStates,
    );
  });
});
