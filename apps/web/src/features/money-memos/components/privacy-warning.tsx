"use client";

import type { PatternDecision } from "@/lib/privacy/pattern-set-v1";

type Props = {
  decision: PatternDecision;
  onEdit: () => void;
  onRemove: () => void;
  onContinue: () => void;
};

export function PrivacyWarning({
  decision,
  onEdit,
  onRemove,
  onContinue,
}: Props) {
  return (
    <aside
      role="note"
      aria-label="Sensitive information warning"
      className="rounded-xl border border-amber-700 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <p className="font-semibold">
        Do not enter bank credentials, account or routing numbers, card details,
        verification codes, banking tokens, bank statements, or government
        identifiers.
      </p>
      <p className="mt-2">
        Cashmemo checks a finite published pattern set and may miss sensitive
        content. It does not provide complete semantic detection.
      </p>
      {decision.kind === "block" ? (
        <div className="mt-3" role="alert">
          <p>
            This text cannot be submitted. Edit or remove it; your unsaved input
            is preserved.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onEdit}>
              Edit text
            </button>
            <button type="button" onClick={onRemove}>
              Remove text
            </button>
          </div>
        </div>
      ) : null}
      {decision.kind === "warn" ? (
        <div className="mt-3" role="status">
          <p>Review this text. You may edit, remove, or continue unchanged.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={onEdit}>
              Edit text
            </button>
            <button type="button" onClick={onRemove}>
              Remove text
            </button>
            <button type="button" onClick={onContinue}>
              Continue unchanged
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
