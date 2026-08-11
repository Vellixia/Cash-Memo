export const TEXT_CONSENT = "SEND_THIS_TEXT_FOR_AI_EXTRACTION" as const;
export const STT_CONSENT = "SEND_THIS_RECORDING_FOR_TRANSCRIPTION" as const;
export const TRANSCRIPT_CONSENT = "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION" as const;

export function ProviderConsent({
  checked,
  mode,
  onChange,
}: {
  readonly checked: boolean;
  readonly mode: "text" | "voice";
  readonly onChange: (checked: boolean) => void;
}) {
  const id = `provider-consent-${mode}`;
  return (
    <div data-testid={id}>
      <label htmlFor={id}>
        <input
          checked={checked}
          id={id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        {mode === "text"
          ? "Send only this text to the AI extraction provider. Nothing is saved as a Money Memo until you review and confirm."
          : "Send only this recording for transcription, then send its transcript for AI extraction."}
      </label>
      {mode === "voice" ? (
        <p data-testid="voice-detector-limitation">
          Raw voice reaches the transcription provider before text privacy detection can run.
        </p>
      ) : null}
    </div>
  );
}
