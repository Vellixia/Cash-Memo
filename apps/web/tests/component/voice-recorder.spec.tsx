/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AssistedCaptureApiPort,
  AssistedDraftView,
  VoiceCaptureView,
} from "../../src/app/journal-api.js";
import { AssistedDraftReview } from "../../src/features/capture/AssistedDraftReview.js";
import { NaturalLanguageCapture } from "../../src/features/capture/NaturalLanguageCapture.js";
import { VoiceRecorder } from "../../src/features/capture/VoiceRecorder.js";
import { ProviderConsent } from "../../src/features/privacy/ProviderConsent.js";

const draft: AssistedDraftView = {
  assessments: [{ field: "amount", reasonCode: "AMBIGUOUS_AMOUNT", status: "uncertain" }],
  authoritative: false,
  captureStartedAt: "2026-08-11T00:00:00.000Z",
  captureTimezone: "Asia/Jakarta",
  expiresAt: "2026-08-18T00:00:00.000Z",
  fields: { amount: "12.50", currency: "USD", direction: "expense" },
  id: "10000000-0000-4000-8000-000000000001",
  origin: "natural_language",
  revision: "1",
  sourceCompleteness: "complete",
  sourceText: "synthetic expense",
  status: "reviewable",
};

function api(overrides: Partial<AssistedCaptureApiPort> = {}): AssistedCaptureApiPort {
  const voice = (state: string, revision: string): VoiceCaptureView => ({
    authoritative: false,
    capability: { ai: "available", stt: "available" },
    draftId: draft.id,
    errorCode: null,
    id: "capture",
    revision,
    state,
  });
  return {
    cancelVoiceCapture: vi.fn(async (_id, revision) => voice("canceled", revision)),
    confirmDraft: vi.fn(async () => ({ id: "memo" })),
    extractText: vi.fn(async () => ({ captureId: "capture", draft, state: "draft_review" })),
    getDraft: vi.fn(async () => draft),
    getVoiceCapture: vi.fn(async () => voice("draft_review", "1")),
    startVoiceCapture: vi.fn(async () => voice("recording", "1")),
    updateDraft: vi.fn(async (_id, input) => ({
      ...draft,
      fields: input.candidateFields,
      revision: "2",
    })),
    uploadVoiceAudio: vi.fn(async () => voice("draft_review", "4")),
    ...overrides,
  };
}

class FakeRecorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  state: RecordingState = "inactive";
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" }),
    });
    this.onstop?.();
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: FakeRecorder });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
      })),
    },
  });
});

describe("review-first assisted capture UI", () => {
  it("requires explicit operation-specific text consent", () => {
    render(<NaturalLanguageCapture api={api()} />);
    fireEvent.change(screen.getByLabelText("Text to extract"), {
      target: { value: "synthetic expense" },
    });
    expect(screen.getByRole("button", { name: "Review extracted draft" })).toBeDisabled();
    expect(screen.getByText(/Send only this text/)).toBeInTheDocument();
  });

  it("blocks supported prohibited text before provider and preserves editing", async () => {
    const extractText = vi.fn();
    render(<NaturalLanguageCapture api={api({ extractText })} />);
    fireEvent.change(screen.getByLabelText("Text to extract"), {
      target: { value: "card 4111111111111111" },
    });
    fireEvent.click(screen.getByLabelText(/Send only this text/));
    fireEvent.click(screen.getByRole("button", { name: "Review extracted draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be sent");
    expect(screen.getByLabelText("Text to extract")).toHaveValue("card 4111111111111111");
    expect(extractText).not.toHaveBeenCalled();
  });

  it("creates a visible non-authoritative review draft, never an automatic memo", async () => {
    render(<NaturalLanguageCapture api={api()} />);
    fireEvent.change(screen.getByLabelText("Text to extract"), {
      target: { value: "synthetic expense" },
    });
    fireEvent.click(screen.getByLabelText(/Send only this text/));
    fireEvent.click(screen.getByRole("button", { name: "Review extracted draft" }));
    expect(await screen.findByTestId("assisted-draft-review")).toBeInTheDocument();
    expect(screen.getByTestId("draft-not-authoritative")).toHaveTextContent("not financial truth");
    expect(screen.getByTestId("confirm-assisted-draft")).toBeDisabled();
  });

  it("preserves failed edits and supports review-field correction", async () => {
    const updateDraft = vi.fn(async () => {
      throw new Error("NETWORK_ERROR");
    });
    render(<AssistedDraftReview api={api({ updateDraft })} initialDraft={draft} />);
    fireEvent.change(screen.getByRole("textbox", { name: /^amount/u }), {
      target: { value: "14.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save corrections" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("edits remain");
    expect(screen.getByRole("textbox", { name: /^amount/u })).toHaveValue("14.25");
  });

  it("shows uncertainty and incomplete transcript correction states", () => {
    render(
      <AssistedDraftReview
        api={api()}
        initialDraft={{ ...draft, sourceCompleteness: "incomplete" }}
      />,
    );
    expect(screen.getByTestId("assessment-amount")).toHaveTextContent("uncertain");
    expect(screen.getByTestId("incomplete-transcript-warning")).toBeInTheDocument();
  });

  it("discloses raw-voice detector limitation and requires consent", () => {
    render(<VoiceRecorder api={api()} />);
    expect(screen.getByTestId("voice-detector-limitation")).toHaveTextContent(
      "before text privacy detection",
    );
    expect(screen.getByRole("button", { name: "Start recording" })).toBeDisabled();
  });

  it("records only after user action and stops into retained review state", async () => {
    render(<VoiceRecorder api={api()} />);
    fireEvent.click(screen.getByLabelText(/Send only this recording/));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("button", { name: "Stop and review recording" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop and review recording" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send this recording" })).toBeEnabled(),
    );
  });

  it("keeps manual path available on microphone denial", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    render(<VoiceRecorder api={api()} />);
    fireEvent.click(screen.getByLabelText(/Send only this recording/));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Manual capture remains available");
  });
});

describe("operation-specific consent copy", () => {
  it("never implies broad account-data access", () => {
    render(<ProviderConsent checked={false} mode="text" onChange={() => undefined} />);
    expect(screen.getByText(/only this text/)).toBeInTheDocument();
    expect(screen.queryByText(/all data|account access/iu)).toBeNull();
  });
});
