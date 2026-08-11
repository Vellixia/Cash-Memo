import { useMemo, useState } from "react";

import type { AssistedCaptureApiPort, AssistedDraftView } from "../../app/journal-api.js";

const fields = [
  "amount",
  "currency",
  "direction",
  "occurredAt",
  "occurredLocal",
  "occurredTimezone",
  "occurredOffsetMinutes",
  "timezoneDatabaseVersion",
  "categoryId",
  "moneySpaceId",
  "planningStatus",
  "purpose",
  "note",
] as const;

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function AssistedDraftReview({
  api,
  initialDraft,
}: {
  readonly api: AssistedCaptureApiPort;
  readonly initialDraft: AssistedDraftView;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [sourceText, setSourceText] = useState(initialDraft.sourceText ?? "");
  const [values, setValues] = useState<Record<string, unknown>>(initialDraft.fields);
  const [state, setState] = useState<
    "editing" | "saving" | "saved" | "confirming" | "confirmed" | "error"
  >("editing");
  const assessments = useMemo(
    () => new Map(draft.assessments.map((item) => [item.field, item])),
    [draft.assessments],
  );

  async function save() {
    setState("saving");
    try {
      const updated = await api.updateDraft(draft.id, {
        candidateFields: values,
        expectedRevision: draft.revision,
        sourceCompleteness: draft.sourceCompleteness,
        sourceText: sourceText.length === 0 ? null : sourceText,
      });
      setDraft(updated);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  async function confirm() {
    setState("confirming");
    try {
      await api.confirmDraft(draft.id, {
        confirmation: "CONFIRM_MONEY_MEMO",
        expectedRevision: draft.revision,
        memo: {
          categoryId: nullable("categoryId"),
          direction: values["direction"] === "income" ? "income" : "expense",
          money: { amount: text(values["amount"]), currency: text(values["currency"]) },
          moneySpaceId: nullable("moneySpaceId"),
          note: nullable("note"),
          occurrence: {
            occurredAt: text(values["occurredAt"]),
            occurredLocal: text(values["occurredLocal"]),
            occurredOffsetMinutes: Number(values["occurredOffsetMinutes"] ?? 0),
            occurredTimezone: text(values["occurredTimezone"]),
            timezoneDatabaseVersion: text(values["timezoneDatabaseVersion"]),
          },
          planningStatus:
            values["planningStatus"] === "planned" || values["planningStatus"] === "unplanned"
              ? values["planningStatus"]
              : null,
          purpose:
            values["purpose"] === "personal" ||
            values["purpose"] === "work" ||
            values["purpose"] === "mixed"
              ? values["purpose"]
              : null,
        },
      });
      setState("confirmed");
    } catch {
      setState("error");
    }
  }

  function nullable(field: string): string | null {
    const value = text(values[field]).trim();
    return value.length === 0 ? null : value;
  }

  const confirmable = [
    "amount",
    "currency",
    "occurredAt",
    "occurredLocal",
    "occurredTimezone",
    "timezoneDatabaseVersion",
  ].every((field) => text(values[field]).trim().length > 0);

  return (
    <section data-testid="assisted-draft-review">
      <h3>Review assisted draft</h3>
      <p data-testid="draft-not-authoritative">
        This is a draft, not financial truth. Review every field before explicit confirmation.
      </p>
      {draft.sourceCompleteness === "incomplete" ? (
        <p data-testid="incomplete-transcript-warning">
          Transcript may be incomplete. Correct missing details.
        </p>
      ) : null}
      {draft.origin === "voice" || draft.sourceText !== null ? (
        <label htmlFor="draft-source-text">
          Transcript or source text
          <textarea
            id="draft-source-text"
            maxLength={4000}
            onChange={(event) => setSourceText(event.target.value)}
            value={sourceText}
          />
        </label>
      ) : null}
      {fields.map((field) => {
        const assessment = assessments.get(field);
        return (
          <label key={field} htmlFor={`draft-${field}`}>
            {field}
            <input
              id={`draft-${field}`}
              value={text(values[field])}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field]: event.target.value }))
              }
            />
            {assessment === undefined ? null : (
              <span data-testid={`assessment-${field}`}>
                {assessment.status}: {assessment.reasonCode ?? "review"}
              </span>
            )}
          </label>
        );
      })}
      <button disabled={state === "saving"} onClick={() => void save()} type="button">
        Save corrections
      </button>
      <button
        data-testid="confirm-assisted-draft"
        disabled={!confirmable || state === "confirming" || state === "confirmed"}
        onClick={() => void confirm()}
        type="button"
      >
        Confirm Money Memo
      </button>
      {state === "saved" ? <p>Corrections saved.</p> : null}
      {state === "error" ? (
        <p role="alert">Draft update unavailable. Your edits remain here.</p>
      ) : null}
      {state === "confirmed" ? <p data-testid="assisted-confirmed">Money Memo confirmed.</p> : null}
    </section>
  );
}
