import { useState } from "react";

import { detectTextV1 } from "@cashmemo/privacy-rules";

import type { AssistedCaptureApiPort, AssistedDraftView } from "../../app/journal-api.js";
import { AssistedDraftReview } from "./AssistedDraftReview.js";
import { ProviderConsent, TEXT_CONSENT } from "../privacy/ProviderConsent.js";

export function NaturalLanguageCapture({ api }: { readonly api: AssistedCaptureApiPort }) {
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<AssistedDraftView | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "sending" | "blocked" | "unavailable">(
    "idle",
  );

  async function extract() {
    setState("checking");
    const result = detectTextV1(text);
    if (result.decision === "block_match") {
      setState("blocked");
      return;
    }
    setState("sending");
    try {
      const response = await api.extractText({
        captureStartedAt: new Date().toISOString(),
        captureTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        consent: TEXT_CONSENT,
        text,
      });
      setDraft(response.draft);
      setState("idle");
    } catch (error) {
      setState(
        error instanceof Error && error.message === "PRIVACY_BOUNDARY_BLOCKED"
          ? "blocked"
          : "unavailable",
      );
    }
  }

  return (
    <section data-testid="natural-language-capture">
      <h3>Describe a Money Memo</h3>
      <p>
        Do not enter card numbers, bank account numbers, passwords, PINs, OTPs, government
        identifiers, or financial statement data.
      </p>
      <label htmlFor="assisted-text">Text to extract</label>
      <textarea
        id="assisted-text"
        maxLength={4000}
        onChange={(event) => setText(event.target.value)}
        value={text}
      />
      <ProviderConsent checked={consent} mode="text" onChange={setConsent} />
      <button
        disabled={!consent || text.trim().length === 0 || state === "sending"}
        onClick={() => void extract()}
        type="button"
      >
        Review extracted draft
      </button>
      {state === "checking" ? <p>Checking privacy boundary…</p> : null}
      {state === "sending" ? <p>Extracting draft…</p> : null}
      {state === "blocked" ? (
        <p role="alert">
          This text cannot be sent. Remove prohibited data and try again. Your text remains
          editable.
        </p>
      ) : null}
      {state === "unavailable" ? (
        <p role="alert">
          AI extraction unavailable. Your text remains editable for retry or manual entry.
        </p>
      ) : null}
      {draft === null ? null : <AssistedDraftReview api={api} initialDraft={draft} />}
    </section>
  );
}
