"use client";

import { useRef, useState, type FormEvent } from "react";

import type { ComposePayload } from "@/lib/compose/db";
import { detectPatternV1 } from "@/lib/privacy/pattern-set-v1";
import type { CreateMoneyMemoRequest, CurrencyRegistry, Label } from "../api";
import { useComposeStore } from "../compose-store";
import { PrivacyWarning } from "./privacy-warning";
import { ValidationSummary } from "./validation-summary";

type Props = {
  creationId: string;
  initialPayload: ComposePayload;
  currencies: CurrencyRegistry["currencies"];
  categories: Label[];
  moneySpaces: Label[];
  onAutosave: (payload: ComposePayload) => Promise<void>;
  onCreate: (request: CreateMoneyMemoRequest) => Promise<void>;
  serviceMessage?: string;
};

type Fields = {
  type: "income" | "expense";
  amount: string;
  currency: string;
  occurrenceWall: string;
  utcOffset: string;
  categoryId: string;
  moneySpaceId: string;
  note: string;
  plannedStatus: "planned" | "unplanned";
  purpose: "personal" | "work" | "mixed";
};

function initialFields(
  payload: ComposePayload,
  categories: Label[],
  spaces: Label[],
): Fields {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 23);
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return {
    type: payload["type"] === "income" ? "income" : "expense",
    amount: payload["amount"] ?? "",
    currency: payload["currency"] ?? "USD",
    occurrenceWall: payload["occurrenceWall"] ?? local,
    utcOffset:
      payload["utcOffset"] ??
      `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`,
    categoryId: payload["categoryId"] ?? categories[0]?.id ?? "",
    moneySpaceId: payload["moneySpaceId"] ?? spaces[0]?.id ?? "",
    note: payload["note"] ?? "",
    plannedStatus:
      payload["plannedStatus"] === "planned" ? "planned" : "unplanned",
    purpose:
      payload["purpose"] === "work" || payload["purpose"] === "mixed"
        ? payload["purpose"]
        : "personal",
  };
}

export function MoneyMemoForm(props: Props) {
  const [fields, setFields] = useState(() =>
    initialFields(props.initialPayload, props.categories, props.moneySpaces),
  );
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const {
    submitting,
    privacyDecision,
    warningContinued,
    safeValidationFields,
    setSubmitting,
    setPrivacyDecision,
    continueWarning,
    setSafeValidationFields,
  } = useComposeStore();

  function update<K extends keyof Fields>(field: K, value: Fields[K]) {
    const next = { ...fields, [field]: value };
    setFields(next);
    setPrivacyDecision({ kind: "clear" });
    void props.onAutosave({ ...next });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid = validate(fields);
    setSafeValidationFields(invalid);
    if (invalid.length > 0) return;
    const decision = detectPatternV1(fields.note);
    setPrivacyDecision(decision);
    if (
      decision.kind === "block" ||
      (decision.kind === "warn" && !warningContinued)
    )
      return;
    setSubmitting(true);
    try {
      await props.onCreate(toRequest(props.creationId, fields));
    } catch {
      // Mutation state renders only its reviewed safe error; draft retention runs in onError.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <ValidationSummary fields={safeValidationFields} />
      <PrivacyWarning
        decision={privacyDecision}
        onEdit={() => noteRef.current?.focus()}
        onRemove={() => update("note", "")}
        onContinue={continueWarning}
      />
      {props.serviceMessage === undefined ? null : (
        <p role="status" className="rounded-xl border p-3">
          {props.serviceMessage}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Type
          <select
            value={fields.type}
            onChange={(event) =>
              update("type", event.target.value as Fields["type"])
            }
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label>
          Amount
          <input
            inputMode="decimal"
            name="amount"
            value={fields.amount}
            onChange={(event) => update("amount", event.target.value)}
            required
          />
        </label>
        <label>
          Currency
          <select
            value={fields.currency}
            onChange={(event) => update("currency", event.target.value)}
          >
            {props.currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Occurrence date and time
          <input
            type="datetime-local"
            step="0.001"
            value={fields.occurrenceWall}
            onChange={(event) => update("occurrenceWall", event.target.value)}
            required
          />
        </label>
        <label>
          UTC offset
          <input
            pattern="[+-][0-9]{2}:[0-9]{2}"
            value={fields.utcOffset}
            onChange={(event) => update("utcOffset", event.target.value)}
            required
          />
        </label>
        <label>
          Category
          <select
            value={fields.categoryId}
            onChange={(event) => update("categoryId", event.target.value)}
          >
            {props.categories.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Money Space
          <select
            value={fields.moneySpaceId}
            onChange={(event) => update("moneySpaceId", event.target.value)}
          >
            {props.moneySpaces.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Planned status
          <select
            value={fields.plannedStatus}
            onChange={(event) =>
              update(
                "plannedStatus",
                event.target.value as Fields["plannedStatus"],
              )
            }
          >
            <option value="unplanned">Unplanned</option>
            <option value="planned">Planned</option>
          </select>
        </label>
        <label>
          Purpose
          <select
            value={fields.purpose}
            onChange={(event) =>
              update("purpose", event.target.value as Fields["purpose"])
            }
          >
            <option value="personal">Personal</option>
            <option value="work">Work</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
      </div>
      <label className="block">
        Note (optional)
        <textarea
          ref={noteRef}
          maxLength={1001}
          value={fields.note}
          onChange={(event) => update("note", event.target.value)}
          className="min-h-28 w-full"
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save Money Memo"}
      </button>
    </form>
  );
}

function validate(fields: Fields): string[] {
  const invalid: string[] = [];
  if (
    !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(fields.amount) ||
    Number(fields.amount) <= 0
  )
    invalid.push("amount");
  if (!/^[A-Z]{3}$/u.test(fields.currency)) invalid.push("currency");
  if (
    fields.occurrenceWall.length === 0 ||
    !/^[+-](?:0[0-9]|1[0-3]):[0-5][0-9]$|^[+-]14:00$/u.test(fields.utcOffset)
  )
    invalid.push("occurrence");
  if (!isUuid(fields.categoryId)) invalid.push("categoryId");
  if (!isUuid(fields.moneySpaceId)) invalid.push("moneySpaceId");
  if (Array.from(fields.note).length > 1000) invalid.push("note");
  return invalid;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    value,
  );
}

function toRequest(creationId: string, fields: Fields): CreateMoneyMemoRequest {
  const wall =
    fields.occurrenceWall.length === 23
      ? `${fields.occurrenceWall}000`
      : `${fields.occurrenceWall}:00.000000`;
  const instant = new Date(`${fields.occurrenceWall}${fields.utcOffset}`)
    .toISOString()
    .replace(/\.([0-9]{3})Z$/u, ".$1000Z");
  return {
    creationId,
    type: fields.type,
    amount: fields.amount,
    currency: fields.currency,
    occurrence: { instant, localWallTime: wall, utcOffset: fields.utcOffset },
    categoryId: fields.categoryId,
    moneySpaceId: fields.moneySpaceId,
    note: fields.note.length === 0 ? null : fields.note,
    plannedStatus: fields.plannedStatus,
    purpose: fields.purpose,
  };
}
