import { useEffect, useMemo, useRef, useState } from "react";

import type { AssistedCaptureApiPort, AssistedDraftView } from "../../app/journal-api.js";
import { evaluateBrowserPrivacy } from "../../privacy/privacy-boundary.js";
import { AssistedDraftReview } from "./AssistedDraftReview.js";
import { CapabilityStatus } from "../degraded/CapabilityStatus.js";
import { IndexedDbDraftStorage, RecoverableDraftStore } from "../degraded/recoverable-draft.js";
import { ProviderConsent, TEXT_CONSENT } from "../privacy/ProviderConsent.js";

export function NaturalLanguageCapture({
  api,
  recoveryScope = "component-fixture",
}: {
  readonly api: AssistedCaptureApiPort;
  readonly recoveryScope?: string;
}) {
  const store = useMemo(
    () => new RecoverableDraftStore(new IndexedDbDraftStorage(), recoveryScope),
    [recoveryScope],
  );
  const retryIdentity = useRef(crypto.randomUUID());
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [draft, setDraft] = useState<AssistedDraftView | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "sending" | "blocked" | "unavailable">(
    "idle",
  );

  useEffect(() => {
    let active = true;
    void store.load().then((recovered) => {
      if (active && recovered !== null) setText((current) => current || recovered.sourceText);
    });
    return () => {
      active = false;
    };
  }, [store]);

  async function extract() {
    setState("checking");
    const result = evaluateBrowserPrivacy("typed_text_ai_transmission", text);
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
      await store.clear();
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
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          if (evaluateBrowserPrivacy("device_draft_persistence", value).decision === "allow") {
            void store.save({
              idempotencyKey: retryIdentity.current,
              sourceText: value,
              status: "editing",
            });
          }
        }}
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
      {state === "unavailable" ? <CapabilityStatus kind="assisted_capture_unavailable" /> : null}
      {draft === null ? null : <AssistedDraftReview api={api} initialDraft={draft} />}
    </section>
  );
}
