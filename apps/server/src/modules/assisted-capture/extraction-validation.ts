import {
  parseMoney,
  resolveLocalOccurrence,
  validateOccurrenceTuple,
  type Occurrence,
} from "@cashmemo/domain";
import { currencyRegistryV1 } from "@cashmemo/currency-registry";

import type { ExtractedDraftFields, ExtractionResult, FieldAssessment } from "./provider-ports.js";

const FIELD_KEYS = [
  "amount",
  "categoryId",
  "currency",
  "direction",
  "moneySpaceId",
  "note",
  "occurredLocal",
  "occurredOffsetMinutes",
  "occurredTimezone",
  "planningStatus",
  "purpose",
] as const;

export interface ExtractionValidationContext {
  readonly categoryKinds: ReadonlyMap<string, "expense" | "income">;
  readonly moneySpaceIds: ReadonlySet<string>;
  readonly now: string;
  readonly timezoneDatabaseVersion: string;
}

export interface ValidatedExtraction {
  readonly assessments: readonly FieldAssessment[];
  readonly fields: ExtractedDraftFields;
  readonly occurrence: Occurrence | null;
  readonly status: "correction_required" | "reviewable";
}

export class ExtractionValidationError extends Error {
  readonly code = "AI_INVALID_OUTPUT";

  constructor() {
    super("Extraction output invalid.");
    this.name = "ExtractionValidationError";
  }
}

function invalid(): never {
  throw new ExtractionValidationError();
}

function strictFields(value: unknown): asserts value is ExtractedDraftFields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(FIELD_KEYS as readonly string[]).includes(key)))
    invalid();
  if (!new Set<unknown>([undefined, null, "expense", "income"]).has(record["direction"])) invalid();
  if (!new Set<unknown>([undefined, null, "personal", "work", "mixed"]).has(record["purpose"]))
    invalid();
  if (!new Set<unknown>([undefined, null, "planned", "unplanned"]).has(record["planningStatus"]))
    invalid();
  if (
    record["note"] !== undefined &&
    record["note"] !== null &&
    (typeof record["note"] !== "string" || record["note"].length > 4_000)
  )
    invalid();
}

export function validateExtractionOutput(
  result: ExtractionResult,
  context: Readonly<ExtractionValidationContext>,
): ValidatedExtraction {
  if (result.state !== "success" && result.state !== "ambiguous") invalid();
  strictFields(result.fields);
  const fields = result.fields;
  const hasAmount = fields.amount !== undefined && fields.amount !== null;
  const hasCurrency = fields.currency !== undefined && fields.currency !== null;
  if (hasAmount !== hasCurrency) invalid();
  if (hasAmount && hasCurrency) {
    parseMoney({ amount: fields.amount, currency: fields.currency }, currencyRegistryV1);
  }
  if (fields.categoryId !== undefined && fields.categoryId !== null) {
    const kind = context.categoryKinds.get(fields.categoryId);
    if (
      kind === undefined ||
      (fields.direction !== null && fields.direction !== undefined && kind !== fields.direction)
    )
      invalid();
  }
  if (
    fields.moneySpaceId !== undefined &&
    fields.moneySpaceId !== null &&
    !context.moneySpaceIds.has(fields.moneySpaceId)
  ) {
    invalid();
  }

  let occurrence: Occurrence | null = null;
  const occurrenceParts = [
    fields.occurredLocal,
    fields.occurredTimezone,
    fields.occurredOffsetMinutes,
  ];
  const providedOccurrenceParts = occurrenceParts.filter(
    (part) => part !== undefined && part !== null,
  ).length;
  if (providedOccurrenceParts !== 0 && providedOccurrenceParts !== 3) invalid();
  if (
    providedOccurrenceParts === 3 &&
    typeof fields.occurredLocal === "string" &&
    typeof fields.occurredTimezone === "string" &&
    typeof fields.occurredOffsetMinutes === "number"
  ) {
    const resolution = resolveLocalOccurrence({
      occurredLocal: fields.occurredLocal,
      occurredTimezone: fields.occurredTimezone,
      timezoneDatabaseVersion: context.timezoneDatabaseVersion,
    });
    if (resolution.status !== "valid") {
      return Object.freeze({
        assessments: Object.freeze([
          ...result.assessments,
          {
            field: "occurredLocal",
            reasonCode: "AMBIGUOUS_DATE",
            source: "ai",
            status: "uncertain",
          } satisfies FieldAssessment,
        ]),
        fields: Object.freeze({ ...fields }),
        occurrence: null,
        status: "correction_required" as const,
      });
    }
    if (resolution.occurrence.occurredOffsetMinutes !== fields.occurredOffsetMinutes) invalid();
    occurrence = validateOccurrenceTuple(resolution.occurrence, { now: context.now });
  }

  const correctionRequired =
    result.state === "ambiguous" ||
    result.assessments.some((assessment) =>
      ["contradictory", "invalid", "missing", "uncertain"].includes(assessment.status),
    );
  return Object.freeze({
    assessments: Object.freeze([...result.assessments]),
    fields: Object.freeze({ ...fields }),
    occurrence,
    status: correctionRequired ? "correction_required" : "reviewable",
  });
}
